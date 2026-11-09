import { mergeThread, type CommentTombstones } from "../core/comment-merge"
import { isCommentThread } from "../core/persistence"
import type { CommentThread } from "../core/types"

// What the browser and the dev server say to each other, and what the comments file holds.
// Kept free of Node and of the DOM so both sides (and the CLI) can use it.

export const BRIDGE_ENDPOINT = "/__mesurer/comments"
export const BRIDGE_FILE = ".mesurer/comments.json"
export const BRIDGE_VERSION = 1

/** A comment thread with the page it is on (the path, query and hash route, as Mesurer keys pages). */
export type BridgeThread = CommentThread & { page: string }

export type BridgeDocument = {
  version: typeof BRIDGE_VERSION
  threads: BridgeThread[]
  /** Threads deleted in the browser, by id, with when, so a stale copy does not bring them back. */
  deleted: CommentTombstones
}

/** What the browser sends: the threads it changed, and the ids of the ones it deleted. */
export type BridgePush = {
  threads: BridgeThread[]
  deleted?: string[]
}

// Deleted ids are kept for a month: longer than any tab stays open with an old copy.
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000

export const emptyBridgeDocument = (): BridgeDocument => ({
  version: BRIDGE_VERSION,
  threads: [],
  deleted: {},
})

export const isBridgeThread = (value: unknown): value is BridgeThread =>
  isCommentThread(value) && typeof (value as { page?: unknown }).page === "string"

const normalizeTombstones = (value: unknown): CommentTombstones => {
  const result: CommentTombstones = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return result
  for (const [id, at] of Object.entries(value)) {
    if (typeof at === "number" && Number.isFinite(at)) result[id] = at
  }
  return result
}

/** Reads a document leniently: threads that do not parse are dropped, not the whole file. */
export const normalizeBridgeDocument = (value: unknown): BridgeDocument => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyBridgeDocument()
  const input = value as Record<string, unknown>
  return {
    version: BRIDGE_VERSION,
    threads: Array.isArray(input.threads) ? input.threads.filter(isBridgeThread) : [],
    deleted: normalizeTombstones(input.deleted),
  }
}

export const normalizeBridgePush = (value: unknown): BridgePush | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.threads)) return null
  return {
    threads: input.threads.filter(isBridgeThread),
    deleted: Array.isArray(input.deleted)
      ? input.deleted.filter((id): id is string => typeof id === "string")
      : [],
  }
}

/** The document with a push from the browser merged in. */
export const applyBridgePush = (
  document: BridgeDocument,
  push: BridgePush,
  now = Date.now(),
): BridgeDocument => {
  const deleted: CommentTombstones = {}
  for (const [id, at] of Object.entries(document.deleted)) {
    if (now - at < TOMBSTONE_TTL) deleted[id] = at
  }
  for (const id of push.deleted ?? []) deleted[id] = Math.max(deleted[id] ?? 0, now)
  const byId = new Map<string, BridgeThread>()
  for (const thread of document.threads) byId.set(thread.id, thread)
  for (const thread of push.threads) {
    const current = byId.get(thread.id)
    byId.set(thread.id, current ? (mergeThread(current, thread) as BridgeThread) : thread)
  }
  return {
    version: BRIDGE_VERSION,
    threads: [...byId.values()].filter((thread) => {
      const at = deleted[thread.id]
      return at === undefined || thread.updatedAt > at
    }),
    deleted,
  }
}

/** Threads grouped by the page they are on. */
export const threadsByPage = (threads: BridgeThread[]): Record<string, CommentThread[]> => {
  const byPage: Record<string, CommentThread[]> = {}
  for (const { page, ...thread } of threads) {
    ;(byPage[page] ??= []).push(thread)
  }
  return byPage
}

/** The thread whose id is `id`, or the only one whose id starts with it (with or without `comment-`). */
export const findThread = (threads: BridgeThread[], id: string) => {
  const exact = threads.find((thread) => thread.id === id)
  if (exact) return { thread: exact }
  const prefixes = [id, `comment-${id}`]
  const matches = threads.filter((thread) => prefixes.some((prefix) => thread.id.startsWith(prefix)))
  if (matches.length === 1) return { thread: matches[0] }
  return { error: matches.length === 0 ? `No comment with id ${id}` : `${matches.length} comments start with ${id}; give more of the id` }
}
