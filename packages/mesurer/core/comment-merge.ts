import type { CommentThread } from "./types"

// Merging the same comments edited in two places (the browser and an agent writing the bridge
// file) without either losing the other's work.
//
// Per thread: messages are the union of both copies, less any either copy deleted; a message in
// both takes the text of the copy updated last. Status, target, resolution and changes come from
// the copy updated last. A message newer than the moment the thread was resolved opens it again.

export type CommentTombstones = Record<string, number>

export const mergeThread = (a: CommentThread, b: CommentThread): CommentThread => {
  if (a === b) return a
  const [newer, older] = b.updatedAt > a.updatedAt ? [b, a] : [a, b]
  const deleted = new Set([...(newer.deletedMessageIds ?? []), ...(older.deletedMessageIds ?? [])])
  const messages = new Map(older.messages.map((message) => [message.id, message]))
  for (const message of newer.messages) messages.set(message.id, message)
  const merged = [...messages.values()]
    .filter((message) => !deleted.has(message.id))
    .sort((x, y) => x.createdAt - y.createdAt)
  const updatedAt = Math.max(newer.updatedAt, ...merged.map((message) => message.createdAt))
  const resolvedAt = newer.resolvedAt ?? newer.updatedAt
  const reopened =
    newer.status === "resolved" && merged.some((message) => message.role === "user" && message.createdAt > resolvedAt)
  const result: CommentThread = {
    ...newer,
    messages: merged,
    updatedAt,
    ...(reopened ? { status: "open" as const } : {}),
  }
  if (deleted.size > 0) result.deletedMessageIds = [...deleted]
  else delete result.deletedMessageIds
  return result
}

/**
 * Both lists merged thread by thread, in the order `base` has them with new ones after. A thread
 * in `deleted` is left out, unless it was changed after it was deleted.
 */
export const mergeThreadLists = (
  base: CommentThread[],
  incoming: CommentThread[],
  deleted: CommentTombstones = {},
): CommentThread[] => {
  const byId = new Map<string, CommentThread>()
  for (const thread of base) byId.set(thread.id, thread)
  for (const thread of incoming) {
    const current = byId.get(thread.id)
    byId.set(thread.id, current ? mergeThread(current, thread) : thread)
  }
  return [...byId.values()].filter((thread) => {
    const at = deleted[thread.id]
    return at === undefined || thread.updatedAt > at
  })
}

export const sameThreads = (a: CommentThread[], b: CommentThread[]) =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b)
