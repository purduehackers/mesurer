// @vitest-environment node
import { createServer, type Server } from "node:http"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCommentsHandler, type CommentsHandler } from "./handler"
import { run } from "./cli"
import type { BridgeDocument, BridgeThread } from "./protocol"

const thread = (overrides: Partial<BridgeThread> = {}): BridgeThread => ({
  id: "comment-abc123",
  page: "/",
  target: {
    selector: "main > h1",
    tagName: "h1",
    textSnippet: "Merch",
    htmlPreview: "<h1>Merch</h1>",
    attributes: {},
    styles: "",
    rect: { left: 0, top: 0, width: 100, height: 20 },
    documentPoint: { x: 10, y: 10 },
    source: { file: "src/pages/index.astro", line: 12, column: 3 },
  },
  messages: [{ id: "m1", role: "user", text: "Make this bigger", createdAt: 100 }],
  status: "open",
  createdAt: 100,
  updatedAt: 100,
  ...overrides,
})

let root: string
let server: Server
let handler: CommentsHandler
let base: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mesurer-bridge-"))
  handler = createCommentsHandler({ root, maxBytes: 64 * 1024 })
  server = createServer((request, response) =>
    handler.handle(request, response, () => {
      response.statusCode = 404
      response.end("not found")
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
})

afterEach(async () => {
  handler.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
})

const put = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/__mesurer/comments`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })

const cli = async (...args: string[]) => {
  const out: string[] = []
  const log = vi.spyOn(console, "log").mockImplementation((line) => void out.push(String(line)))
  const err = vi.spyOn(console, "error").mockImplementation((line) => void out.push(String(line)))
  try {
    const code = await run([...args, "--root", root])
    return { code, out: out.join("\n") }
  } finally {
    log.mockRestore()
    err.mockRestore()
  }
}

describe("comments bridge", () => {
  it("serves an empty document before anything is saved", async () => {
    const response = await fetch(`${base}/__mesurer/comments`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: 1, threads: [], deleted: {} })
  })

  it("passes other requests on", async () => {
    expect((await fetch(`${base}/other`)).status).toBe(404)
  })

  it("saves pushed threads to the file, ignored by git", async () => {
    const response = await put({ threads: [thread()] })
    expect(response.status).toBe(200)
    const document = (await response.json()) as BridgeDocument
    expect(document.threads).toHaveLength(1)
    const file = JSON.parse(await readFile(path.join(root, ".mesurer/comments.json"), "utf8"))
    expect(file.threads[0].id).toBe("comment-abc123")
    expect(await readFile(path.join(root, ".mesurer/.gitignore"), "utf8")).toBe("*\n")
    await expect(stat(path.join(root, ".mesurer/comments.json.lock"))).rejects.toThrow()
  })

  it("refuses other origins, non-JSON bodies and bodies too large", async () => {
    expect((await put({ threads: [] }, { Origin: "https://evil.example" })).status).toBe(403)
    expect((await put({ threads: [] }, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403)
    const text = await fetch(`${base}/__mesurer/comments`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "{}" })
    expect(text.status).toBe(415)
    const big = await put({ threads: [thread({ target: { ...thread().target, htmlPreview: "x".repeat(70_000) } })] })
    expect(big.status).toBe(413)
    expect((await put({ nope: true })).status).toBe(400)
  })

  it("lets the CLI list, reply to and resolve a comment, and the browser's next push keeps that", async () => {
    await put({ threads: [thread()] })
    const listed = await cli("comments", "list")
    expect(listed.out).toContain("abc123")
    expect(listed.out).toContain("src/pages/index.astro:12:3")

    expect((await cli("comments", "reply", "abc", "Bumping", "to", "text-4xl")).code).toBe(0)
    expect((await cli("comments", "resolve", "abc123", "Changed h1 to text-4xl in index.astro")).code).toBe(0)
    const shown = await cli("comments", "show", "abc123")
    expect(shown.out).toContain("[agent")
    expect(shown.out).toContain("Resolved by agent: Changed h1 to text-4xl in index.astro")

    // The browser, not having seen that yet, saves its older copy with a new reply of its own.
    const stale = thread({
      messages: [...thread().messages, { id: "m2", role: "user", text: "and bold", createdAt: 150 }],
      updatedAt: 150,
    })
    const merged = (await (await put({ threads: [stale] })).json()) as BridgeDocument
    const result = merged.threads[0]
    expect(result.messages.map((message) => message.role)).toEqual(["user", "user", "agent"])
    expect(result.status).toBe("resolved")
    expect(result.resolution).toBe("Changed h1 to text-4xl in index.astro")
  })

  it("deletes threads the browser says it deleted, and keeps them deleted", async () => {
    await put({ threads: [thread(), thread({ id: "comment-other" })] })
    const afterDelete = (await (await put({ threads: [], deleted: ["comment-abc123"] })).json()) as BridgeDocument
    expect(afterDelete.threads.map((item) => item.id)).toEqual(["comment-other"])
    const stale = (await (await put({ threads: [thread()] })).json()) as BridgeDocument
    expect(stale.threads.map((item) => item.id)).toEqual(["comment-other"])
  })

  it("reports an unknown or ambiguous id", async () => {
    await put({ threads: [thread(), thread({ id: "comment-abd999" })] })
    expect((await cli("comments", "show", "zzz")).out).toContain("No comment with id zzz")
    expect((await cli("comments", "show", "ab")).out).toContain("2 comments start with ab")
  })

  it("streams the file to the browser when the CLI changes it", async () => {
    await put({ threads: [thread()] })
    const controller = new AbortController()
    const response = await fetch(`${base}/__mesurer/comments/events`, { signal: controller.signal })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let received = ""
    const nextEvent = async () => {
      for (;;) {
        const end = received.indexOf("\n\n", received.indexOf("event: comments"))
        if (received.includes("event: comments") && end !== -1) {
          const chunk = received.slice(received.indexOf("event: comments"), end)
          received = received.slice(end + 2)
          return JSON.parse(chunk.split("data: ")[1]) as BridgeDocument
        }
        const { value, done } = await reader.read()
        if (done) throw new Error("stream ended")
        received += decoder.decode(value)
      }
    }
    expect((await nextEvent()).threads[0].status).toBe("open")
    await cli("comments", "resolve", "abc123", "done")
    expect((await nextEvent()).threads[0].status).toBe("resolved")
    controller.abort()
  })

  it("reads a hand-broken file as empty instead of failing", async () => {
    await put({ threads: [thread()] })
    await writeFile(path.join(root, ".mesurer/comments.json"), "{ not json")
    const response = await fetch(`${base}/__mesurer/comments`)
    expect((await response.json()).threads).toEqual([])
  })
})
