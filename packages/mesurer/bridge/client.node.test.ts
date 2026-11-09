// @vitest-environment node
import { createServer, type Server } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { createCommentsHandler, type CommentsHandler } from "./handler"
import { createBridgePersistence } from "./client"
import { run } from "./cli"
import { DEFAULT_SESSION_CHROME, EMPTY_PAGE_ARTIFACTS, type MesurerPersistenceSnapshot, type PagedWorkspaceStore } from "../core/persistence"
import type { CommentThread } from "../core/types"

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

let root: string
let server: Server
let handler: CommentsHandler
let origin: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mesurer-client-"))
  handler = createCommentsHandler({ root })
  server = createServer((request, response) => handler.handle(request, response, () => {
    response.statusCode = 404
    response.setHeader("Content-Type", "text/html")
    response.end("<!doctype html>")
  }))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
})

afterEach(async () => {
  handler.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
})

const fakeWindow = () => ({
  fetch: (url: string, init?: RequestInit) => fetch(new URL(url, origin), init),
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  crypto: globalThis.crypto,
  location: { pathname: "/", search: "", hash: "" },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}) as unknown as Window & typeof globalThis

const comment = (id: string, text: string): CommentThread => ({
  id,
  target: {
    selector: "h1",
    tagName: "h1",
    textSnippet: "",
    htmlPreview: "<h1></h1>",
    attributes: {},
    styles: "",
    rect: { left: 0, top: 0, width: 1, height: 1 },
    documentPoint: { x: 0, y: 0 },
  },
  messages: [{ id: `${id}-m`, role: "user", text, createdAt: Date.now() }],
  status: "open",
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const workspaceWith = (pages: Record<string, CommentThread[]>): PagedWorkspaceStore => ({
  ...DEFAULT_SESSION_CHROME,
  pages: Object.fromEntries(
    Object.entries(pages).map(([page, comments]) => [page, { ...EMPTY_PAGE_ARTIFACTS, comments }]),
  ),
})

const until = async (check: () => boolean, ms = 2000) => {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error("timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

it("sends comments to the file, hears the agent's answer, and deletes only what was deleted", async () => {
  const persistence = createBridgePersistence({ ownerWindow: fakeWindow() })
  const updates: MesurerPersistenceSnapshot[] = []
  persistence.subscribe?.((snapshot) => {
    if (snapshot?.comments) updates.push(snapshot)
  })
  persistence.load()
  await until(() => updates.length > 0)

  const a = comment("comment-a", "bigger")
  const b = comment("comment-b", "red")
  persistence.saveWorkspace(workspaceWith({ "/": [a], "/shop": [b] }))
  await until(() => (updates.at(-1)?.comments?.byPage["/shop"]?.length ?? 0) === 1)

  // The agent resolves it; without an event stream here, the next save's answer carries it back.
  await run(["comments", "resolve", "comment-a", "done", "--root", root])
  // A save from a stale copy of "/shop" that lacks a thread does not delete it.
  persistence.saveWorkspace(workspaceWith({ "/": [a], "/shop": [] }))
  await new Promise((resolve) => setTimeout(resolve, 200))
  const document = await handler.store.read()
  expect(document.threads.map((thread) => thread.id).sort()).toEqual(["comment-a", "comment-b"])

  persistence.commentsDeleted?.(["comment-b"])
  await until(() => updates.at(-1)?.comments?.byPage["/shop"] === undefined)
  expect((await handler.store.read()).threads.map((thread) => thread.id)).toEqual(["comment-a"])

  // Loading again merges the file's copy, resolved by the agent, into the page.
  const loaded = persistence.load()
  const pages = (loaded?.workspace as PagedWorkspaceStore).pages
  expect(pages["/"]?.comments?.[0].status).toBe("resolved")
  expect(pages["/"]?.comments?.[0].resolution).toBe("done")
})

it("falls back to localStorage alone when the server has no bridge", async () => {
  handler.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  server = createServer((_request, response) => {
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
  handler = createCommentsHandler({ root })

  const ownerWindow = fakeWindow()
  const persistence = createBridgePersistence({ ownerWindow })
  persistence.load()
  await new Promise((resolve) => setTimeout(resolve, 100))
  persistence.saveWorkspace(workspaceWith({ "/": [comment("comment-a", "x")] }))
  const reloaded = persistence.load()
  expect((reloaded?.workspace as PagedWorkspaceStore).pages["/"]?.comments?.[0].id).toBe("comment-a")
  expect((await handler.store.read()).threads).toEqual([])
})
