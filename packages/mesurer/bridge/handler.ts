import type { IncomingMessage, ServerResponse } from "node:http"
import {
  applyBridgePush,
  BRIDGE_ENDPOINT,
  normalizeBridgePush,
  type BridgeDocument,
} from "./protocol"
import { createCommentsStore, type CommentsStore, type CommentsStoreOptions } from "./store"

// The bridge's HTTP side, as a Connect-style middleware: it works as is in Vite's dev server,
// Express and Connect, and anything with Node's request and response can wrap it.
//
//   GET  /__mesurer/comments          the comments file
//   PUT  /__mesurer/comments          merge the browser's changes in; answers with the result
//   GET  /__mesurer/comments/events   server-sent events: the file, each time it changes

export type CommentsHandlerOptions = CommentsStoreOptions & {
  /** Where the endpoints are. Defaults to `/__mesurer/comments`. */
  endpoint?: string
  /** The largest request body accepted, in bytes. Defaults to 5 MB. */
  maxBytes?: number
  /** Use this store instead of opening one at `root`/`file`. */
  store?: CommentsStore
}

export type CommentsHandler = {
  /** Handles the bridge's requests, and passes anything else to `next`. */
  handle: (request: IncomingMessage, response: ServerResponse, next?: (error?: unknown) => void) => void
  store: CommentsStore
  /** Stops watching the file and closes open event streams. */
  close: () => void
}

const KEEP_ALIVE_MS = 25_000

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.statusCode = status
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.setHeader("Cache-Control", "no-store")
  response.end(JSON.stringify(body))
}

const readBody = (request: IncomingMessage, maxBytes: number) =>
  new Promise<string>((resolve, reject) => {
    const declared = Number(request.headers["content-length"])
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, "Request body too large"))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new HttpError(413, "Request body too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })

// Only the page the dev server serves may use the bridge, not another site open in the same
// browser: a request from another origin is refused. (A cross-site PUT with a JSON body also
// needs a CORS preflight, which this never answers.)
const isSameOrigin = (request: IncomingMessage) => {
  if (request.headers["sec-fetch-site"] === "cross-site") return false
  const origin = request.headers.origin
  if (!origin || origin === "null") return origin !== "null"
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

export const createCommentsHandler = (options: CommentsHandlerOptions = {}): CommentsHandler => {
  const endpoint = (options.endpoint ?? BRIDGE_ENDPOINT).replace(/\/+$/, "")
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024
  const store = options.store ?? createCommentsStore(options)
  const clients = new Set<ServerResponse>()
  let stopWatching: (() => void) | null = null
  let keepAlive: ReturnType<typeof setInterval> | null = null

  const broadcast = (document: BridgeDocument) => {
    const message = `event: comments\ndata: ${JSON.stringify(document)}\n\n`
    for (const client of clients) client.write(message)
  }

  const openStream = async (request: IncomingMessage, response: ServerResponse) => {
    response.statusCode = 200
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8")
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Connection", "keep-alive")
    response.write("retry: 2000\n\n")
    clients.add(response)
    if (!stopWatching) stopWatching = store.watch(broadcast)
    if (!keepAlive) {
      keepAlive = setInterval(() => {
        for (const client of clients) client.write(": keep-alive\n\n")
      }, KEEP_ALIVE_MS)
      keepAlive.unref?.()
    }
    request.on("close", () => {
      clients.delete(response)
    })
    const document = await store.read()
    response.write(`event: comments\ndata: ${JSON.stringify(document)}\n\n`)
  }

  const route = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    const pathname = url.pathname.replace(/\/+$/, "")
    if (pathname !== endpoint && pathname !== `${endpoint}/events`) return false
    if (!isSameOrigin(request)) throw new HttpError(403, "Cross-origin requests are not allowed")

    if (pathname === `${endpoint}/events`) {
      if (request.method !== "GET") throw new HttpError(405, "Method not allowed")
      await openStream(request, response)
      return true
    }
    if (request.method === "GET") {
      sendJson(response, 200, await store.read())
      return true
    }
    if (request.method === "PUT" || request.method === "POST") {
      const type = request.headers["content-type"] ?? ""
      if (!type.includes("application/json")) throw new HttpError(415, "Expected application/json")
      let body: unknown
      try {
        body = JSON.parse(await readBody(request, maxBytes))
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new HttpError(400, "Invalid JSON")
      }
      const push = normalizeBridgePush(body)
      if (!push) throw new HttpError(400, "Expected { threads: [...], deleted?: [...] }")
      const document = await store.update((current) => applyBridgePush(current, push))
      sendJson(response, 200, document)
      broadcast(document)
      return true
    }
    throw new HttpError(405, "Method not allowed")
  }

  const handle: CommentsHandler["handle"] = (request, response, next) => {
    route(request, response)
      .then((handled) => {
        if (!handled) next?.()
      })
      .catch((error: unknown) => {
        if (response.headersSent) {
          response.end()
          return
        }
        if (error instanceof HttpError) {
          sendJson(response, error.status, { error: error.message })
          return
        }
        sendJson(response, 500, { error: error instanceof Error ? error.message : "Internal error" })
      })
  }

  const close = () => {
    stopWatching?.()
    stopWatching = null
    if (keepAlive) clearInterval(keepAlive)
    keepAlive = null
    for (const client of clients) client.end()
    clients.clear()
  }

  return { handle, store, close }
}
