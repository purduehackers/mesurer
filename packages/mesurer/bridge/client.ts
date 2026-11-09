import { mergeThreadLists } from "../core/comment-merge"
import {
  createLocalStoragePersistence,
  EMPTY_PAGE_ARTIFACTS,
  isPagedWorkspaceStore,
  type MesurerPersistence,
  type MesurerPersistenceSnapshot,
  type PagedWorkspaceStore,
  type PersistenceChangeSource,
  toPageArtifacts,
  toSessionChrome,
} from "../core/persistence"
import type { CommentThread } from "../core/types"
import { getPageKey, getTabId, SETTINGS_STORAGE_KEY } from "../core/workspace"
import {
  BRIDGE_ENDPOINT,
  normalizeBridgeDocument,
  threadsByPage,
  type BridgeDocument,
  type BridgePush,
  type BridgeThread,
} from "./protocol"

// Persistence that keeps comments in the project, through the dev server, where a coding agent
// can read and answer them. Everything else (settings, guides, drawings) stays in localStorage.
//
// Loading is synchronous and the server is not, so the first load is the localStorage copy; the
// file arrives a moment later, and every change to it after that, as an update to subscribers.
// If the server has no bridge (a production build, a server without the plugin) this is just
// the localStorage persistence.

export type BridgePersistenceOptions = {
  /** Where the bridge is served. Defaults to `/__mesurer/comments`. */
  endpoint?: string
  /** Where everything but comments is kept. Defaults to Mesurer's own localStorage persistence. */
  base?: MesurerPersistence
  ownerWindow?: Window & typeof globalThis
}

type Listener = Parameters<NonNullable<MesurerPersistence["subscribe"]>>[0]

const COMMENTS_ONLY: PersistenceChangeSource = { settings: false, workspace: false, comments: true }

export const createBridgePersistence = (options: BridgePersistenceOptions = {}): MesurerPersistence => {
  const ownerWindow = options.ownerWindow ?? window
  const endpoint = (options.endpoint ?? BRIDGE_ENDPOINT).replace(/\/+$/, "")
  const base =
    options.base ??
    createLocalStoragePersistence(ownerWindow, `mesurer-state:${getTabId(ownerWindow)}`, SETTINGS_STORAGE_KEY)

  let state: "idle" | "connecting" | "connected" | "unavailable" = "idle"
  let document: BridgeDocument | null = null
  let documentRaw = ""
  // Each thread as the file last had it, to send only what changed.
  let fileThreads = new Map<string, string>()
  // Threads the person deleted, sent with the next push.
  const pendingDeleted = new Set<string>()
  let pendingPush: PagedWorkspaceStore | null = null
  let pushing = false
  let events: EventSource | null = null
  const listeners = new Set<Listener>()
  let errorHandler: ((error: unknown) => void) | undefined

  const commentsUpdate = () => ({
    byPage: threadsByPage(document?.threads ?? []),
    deleted: document?.deleted ?? {},
  })

  const receive = (next: BridgeDocument) => {
    const raw = JSON.stringify(next)
    if (raw === documentRaw) return
    documentRaw = raw
    document = next
    fileThreads = new Map(next.threads.map((thread) => [thread.id, JSON.stringify(thread)]))
    const snapshot: MesurerPersistenceSnapshot = {
      settings: base.load()?.settings ?? {},
      workspace: null,
      comments: commentsUpdate(),
    }
    for (const listener of listeners) listener(snapshot, COMMENTS_ONLY)
  }

  const connect = () => {
    if (state !== "idle") return
    state = "connecting"
    void ownerWindow
      .fetch(endpoint, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
          state = "unavailable"
          pendingPush = null
          pendingDeleted.clear()
          return
        }
        state = "connected"
        receive(normalizeBridgeDocument(await response.json()))
        if (typeof ownerWindow.EventSource === "function") {
          events = new ownerWindow.EventSource(`${endpoint}/events`)
          events.addEventListener("comments", (event) => {
            try {
              receive(normalizeBridgeDocument(JSON.parse((event as MessageEvent<string>).data)))
            } catch (error) {
              errorHandler?.(error)
            }
          })
        }
        flush()
      })
      .catch(() => {
        state = "unavailable"
        pendingPush = null
        pendingDeleted.clear()
      })
  }

  const buildPush = (workspace: PagedWorkspaceStore | null): BridgePush | null => {
    const threads: BridgeThread[] = []
    for (const [page, artifacts] of Object.entries(workspace?.pages ?? {})) {
      for (const thread of artifacts?.comments ?? []) {
        if (pendingDeleted.has(thread.id)) continue
        const withPage: BridgeThread = { ...thread, page }
        if (fileThreads.get(thread.id) !== JSON.stringify(withPage)) threads.push(withPage)
      }
    }
    const deleted = [...pendingDeleted]
    pendingDeleted.clear()
    if (threads.length === 0 && deleted.length === 0) return null
    return { threads, deleted }
  }

  const flush = () => {
    if (state !== "connected" || pushing || (!pendingPush && pendingDeleted.size === 0)) return
    const push = buildPush(pendingPush)
    pendingPush = null
    if (!push) return
    pushing = true
    void ownerWindow
      .fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(push),
        keepalive: JSON.stringify(push).length < 60_000,
      })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Mesurer bridge: ${response.status} ${await response.text()}`)
        receive(normalizeBridgeDocument(await response.json()))
      })
      .catch((error: unknown) => errorHandler?.(error))
      .finally(() => {
        pushing = false
        flush()
      })
  }

  // The base's snapshot with the file's comments merged into each page.
  const withFileComments = (snapshot: MesurerPersistenceSnapshot | null) => {
    if (!snapshot || !document || document.threads.length === 0) return snapshot
    const workspace = snapshot.workspace
    if (!isPagedWorkspaceStore(workspace)) return snapshot
    const pages = { ...workspace.pages }
    const byPage = threadsByPage(document.threads)
    for (const [page, threads] of Object.entries(byPage)) {
      const artifacts = pages[page] ?? EMPTY_PAGE_ARTIFACTS
      const comments: CommentThread[] = mergeThreadLists(artifacts.comments ?? [], threads, document.deleted)
      pages[page] = { ...artifacts, comments }
    }
    return { ...snapshot, workspace: { ...workspace, pages } }
  }

  return {
    persistsWorkspace: true,
    load: () => {
      connect()
      return withFileComments(base.load())
    },
    saveSettings: (settings) => base.saveSettings(settings),
    saveWorkspace: (workspace) => {
      base.saveWorkspace(workspace)
      if (state === "unavailable") return
      pendingPush = isPagedWorkspaceStore(workspace)
        ? workspace
        : { ...toSessionChrome(workspace), pages: { [getPageKey(ownerWindow)]: toPageArtifacts(workspace) } }
      flush()
    },
    commentsDeleted: (ids) => {
      if (state === "unavailable") return
      for (const id of ids) pendingDeleted.add(id)
      flush()
    },
    clearWorkspace: () => base.clearWorkspace(),
    clearSettings: () => base.clearSettings(),
    setErrorHandler: (handler) => {
      errorHandler = handler
      base.setErrorHandler?.(handler)
    },
    subscribe: (listener) => {
      connect()
      listeners.add(listener)
      const unsubscribeBase = base.subscribe?.((snapshot, source) => listener(withFileComments(snapshot), source))
      // A file read before this subscriber came is handed over now.
      if (document) {
        listener({ settings: base.load()?.settings ?? {}, workspace: null, comments: commentsUpdate() }, COMMENTS_ONLY)
      }
      return () => {
        listeners.delete(listener)
        unsubscribeBase?.()
        if (listeners.size === 0) {
          events?.close()
          events = null
          if (state === "connected") state = "idle"
        }
      }
    },
  }
}
