import { describe, expect, it } from "vitest"
import { mergeThread, mergeThreadLists } from "./comment-merge"
import type { CommentThread } from "./types"

const thread = (overrides: Partial<CommentThread> = {}): CommentThread => ({
  id: "comment-1",
  target: {
    selector: "main > h1",
    tagName: "h1",
    textSnippet: "Merch",
    htmlPreview: "<h1>Merch</h1>",
    attributes: {},
    styles: "",
    rect: { left: 0, top: 0, width: 100, height: 20 },
    documentPoint: { x: 10, y: 10 },
  },
  messages: [{ id: "m1", role: "user", text: "Bigger please", createdAt: 100 }],
  status: "open",
  createdAt: 100,
  updatedAt: 100,
  ...overrides,
})

describe("mergeThread", () => {
  it("takes status and resolution from the copy updated last", () => {
    const browser = thread()
    const agent = thread({ status: "resolved", resolvedAt: 200, resolvedBy: "agent", resolution: "Done", updatedAt: 200 })
    expect(mergeThread(browser, agent)).toEqual(agent)
    expect(mergeThread(agent, browser)).toEqual(agent)
  })

  it("keeps replies written on both sides at once", () => {
    const agent = thread({
      messages: [...thread().messages, { id: "a1", role: "agent", text: "On it", createdAt: 150 }],
      updatedAt: 150,
    })
    const browser = thread({
      messages: [...thread().messages, { id: "u2", role: "user", text: "Also red", createdAt: 140 }],
      updatedAt: 140,
    })
    expect(mergeThread(agent, browser).messages.map((m) => m.id)).toEqual(["m1", "u2", "a1"])
    expect(mergeThread(browser, agent).messages.map((m) => m.id)).toEqual(["m1", "u2", "a1"])
  })

  it("does not bring back a deleted message", () => {
    const withReply = thread({
      messages: [...thread().messages, { id: "u2", role: "user", text: "Typo", createdAt: 120 }],
      updatedAt: 120,
    })
    const deleted = thread({ deletedMessageIds: ["u2"], updatedAt: 130 })
    expect(mergeThread(withReply, deleted).messages.map((m) => m.id)).toEqual(["m1"])
    expect(mergeThread(deleted, withReply).deletedMessageIds).toEqual(["u2"])
  })

  it("takes an edited message's text from the copy updated last", () => {
    const edited = thread({ messages: [{ id: "m1", role: "user", text: "Much bigger", createdAt: 100 }], updatedAt: 300 })
    expect(mergeThread(thread(), edited).messages[0].text).toBe("Much bigger")
  })

  it("reopens a resolved thread when the person replies after it was resolved", () => {
    const resolved = thread({ status: "resolved", resolvedAt: 200, resolvedBy: "agent", updatedAt: 200 })
    const replied = thread({
      messages: [...thread().messages, { id: "u2", role: "user", text: "Not quite", createdAt: 250 }],
      updatedAt: 150,
    })
    const merged = mergeThread(resolved, replied)
    expect(merged.status).toBe("open")
    expect(merged.updatedAt).toBe(250)
  })

  it("stays resolved when the agent replies while resolving", () => {
    const resolved = thread({
      status: "resolved",
      resolvedAt: 200,
      messages: [...thread().messages, { id: "a1", role: "agent", text: "Done", createdAt: 200 }],
      updatedAt: 200,
    })
    expect(mergeThread(thread(), resolved).status).toBe("resolved")
  })
})

describe("mergeThreadLists", () => {
  it("adds threads from both sides and drops deleted ones", () => {
    const a = thread({ id: "a" })
    const b = thread({ id: "b" })
    const c = thread({ id: "c", updatedAt: 500 })
    expect(mergeThreadLists([a, b], [c], { b: 300 }).map((t) => t.id)).toEqual(["a", "c"])
  })

  it("keeps a thread changed after it was deleted", () => {
    const b = thread({ id: "b", updatedAt: 400 })
    expect(mergeThreadLists([], [b], { b: 300 }).map((t) => t.id)).toEqual(["b"])
  })
})
