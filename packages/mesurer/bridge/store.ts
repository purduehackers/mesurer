import { mkdirSync, promises as fs, watch, type FSWatcher } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import {
  BRIDGE_FILE,
  emptyBridgeDocument,
  normalizeBridgeDocument,
  type BridgeDocument,
} from "./protocol"

// The comments file on disk. Every change is a read-modify-write under a lock file, written to a
// temporary file and renamed into place, so the dev server and the CLI (two processes) can both
// write it without one losing the other's change or anyone reading half a file.

export type CommentsStoreOptions = {
  /** The project root. Defaults to the current directory. */
  root?: string
  /** The file, relative to `root`. Defaults to `.mesurer/comments.json`. */
  file?: string
}

export type CommentsStore = {
  readonly file: string
  read: () => Promise<BridgeDocument>
  update: (change: (document: BridgeDocument) => BridgeDocument) => Promise<BridgeDocument>
  /** Calls `listener` when the file is changed by something other than this store. */
  watch: (listener: (document: BridgeDocument) => void) => () => void
}

const LOCK_STALE_MS = 10_000
const LOCK_TIMEOUT_MS = 5_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT"

export const createCommentsStore = (options: CommentsStoreOptions = {}): CommentsStore => {
  const root = path.resolve(options.root ?? process.cwd())
  const file = path.resolve(root, options.file ?? BRIDGE_FILE)
  const directory = path.dirname(file)
  const lockFile = `${file}.lock`
  // What this store last read or wrote, so the watcher can tell its own writes from others'.
  let lastRaw: string | null = null
  // One change at a time within this process; the lock file covers other processes.
  let queue: Promise<unknown> = Promise.resolve()

  const ensureDirectory = async () => {
    await fs.mkdir(directory, { recursive: true })
    // The folder keeps itself out of git. Delete this file to commit the comments instead.
    if (path.basename(directory) === ".mesurer") {
      await fs.writeFile(path.join(directory, ".gitignore"), "*\n", { flag: "wx" }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      })
    }
  }

  const readRaw = async () => {
    try {
      return await fs.readFile(file, "utf8")
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  const parse = (raw: string | null): BridgeDocument => {
    if (!raw || !raw.trim()) return emptyBridgeDocument()
    try {
      return normalizeBridgeDocument(JSON.parse(raw))
    } catch {
      // A file half-edited by hand reads as empty rather than taking the server down; it is not
      // overwritten until something is saved.
      return emptyBridgeDocument()
    }
  }

  const acquireLock = async () => {
    const started = Date.now()
    for (;;) {
      try {
        const handle = await fs.open(lockFile, "wx")
        await handle.writeFile(String(process.pid))
        await handle.close()
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        const stat = await fs.stat(lockFile).catch(() => null)
        if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(lockFile, { force: true })
          continue
        }
        if (Date.now() - started > LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for ${path.relative(root, lockFile)}; delete it if no Mesurer process is running`)
        }
        await sleep(25)
      }
    }
  }

  const writeAtomically = async (raw: string) => {
    const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
    await fs.writeFile(temporary, raw, "utf8")
    try {
      await fs.rename(temporary, file)
    } catch (error) {
      await fs.rm(temporary, { force: true })
      throw error
    }
  }

  const read = async () => {
    const raw = await readRaw()
    return parse(raw)
  }

  const update: CommentsStore["update"] = (change) => {
    const run = async () => {
      await ensureDirectory()
      await acquireLock()
      try {
        const current = parse(await readRaw())
        const next = change(current)
        const raw = `${JSON.stringify(next, null, 2)}\n`
        lastRaw = raw
        await writeAtomically(raw)
        return next
      } finally {
        await fs.rm(lockFile, { force: true })
      }
    }
    const result = queue.then(run, run)
    queue = result.catch(() => undefined)
    return result
  }

  const watchFile: CommentsStore["watch"] = (listener) => {
    let watcher: FSWatcher | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let closed = false
    const check = async () => {
      const raw = await readRaw().catch(() => null)
      if (closed || raw === null || raw === lastRaw) return
      lastRaw = raw
      listener(parse(raw))
    }
    // Set up before returning, so no change made after this call is missed.
    mkdirSync(directory, { recursive: true })
    // The directory, not the file: the file is replaced by a rename on every write.
    watcher = watch(directory, (_event, name) => {
      if (name && name.toString() !== path.basename(file)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void check(), 40)
    })
    watcher.on("error", () => undefined)
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      watcher?.close()
    }
  }

  return { file, read, update, watch: watchFile }
}
