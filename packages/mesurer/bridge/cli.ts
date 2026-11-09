import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { findThread, type BridgeDocument, type BridgeThread } from "./protocol"
import { createCommentsStore } from "./store"

// `mesurer comments …`: how a coding agent (or a person) reads and answers the comments left in
// the browser. Changes go through the same locked, merged writes as the dev server, so nothing a
// browser saves at the same moment is lost.

const USAGE = `Usage: mesurer comments <command> [options]

Commands:
  list [--all] [--json]       Open comments (--all: resolved too)
  show <id> [--json]          One comment in full: element, source, messages, changes
  reply <id> <text>           Reply as the agent
  resolve <id> [note]         Mark resolved, with an optional note on what was done
  reopen <id>                 Mark open again
  instructions                How an agent should work with these comments

Options:
  --root <dir>    Project root (default: current directory)
  --file <path>   Comments file, relative to the root (default: .mesurer/comments.json)

An <id> can be a unique prefix, with or without "comment-".`

type Flags = { root?: string; file?: string; all: boolean; json: boolean }

const parseArgs = (argv: string[]) => {
  const flags: Flags = { all: false, json: false }
  const positional: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--root") flags.root = argv[++index]
    else if (arg === "--file") flags.file = argv[++index]
    else if (arg === "--all") flags.all = true
    else if (arg === "--json") flags.json = true
    else if (arg === "-h" || arg === "--help") positional.unshift("help")
    else positional.push(arg)
  }
  return { flags, positional }
}

const shortId = (id: string) => id.replace(/^comment-/, "").slice(0, 8)

const oneLine = (text: string, max = 80) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const formatSource = (thread: BridgeThread) => {
  const source = thread.target.source
  if (!source) return null
  return `${source.file}${source.line ? `:${source.line}` : ""}${source.column ? `:${source.column}` : ""}`
}

const formatList = (document: BridgeDocument, all: boolean) => {
  const threads = document.threads.filter((thread) => all || thread.status === "open")
  if (threads.length === 0) return all ? "No comments." : "No open comments."
  return threads
    .map((thread) => {
      const first = thread.messages[0]?.text ?? ""
      const status = thread.status === "resolved" ? " [resolved]" : ""
      const kind = thread.changes?.length ? ` [tweak: ${thread.changes.length} change${thread.changes.length === 1 ? "" : "s"}]` : ""
      const where = formatSource(thread) ?? thread.target.selector
      return `${shortId(thread.id)}  ${thread.page}${status}${kind}\n          ${oneLine(first) || "(no text)"}\n          ${where}`
    })
    .join("\n")
}

const formatThread = (thread: BridgeThread) => {
  const { target } = thread
  const lines = [
    `Comment ${thread.id} (${thread.status})`,
    `Page: ${thread.page}${target.url ? `  (${target.url})` : ""}`,
    target.viewport ? `Viewport: ${target.viewport.width} × ${target.viewport.height} CSS px${target.preview ? " (responsive preview)" : ""}` : "",
    formatSource(thread) ? `Source: ${formatSource(thread)}` : "",
    `Element: <${target.tagName}>  selector: ${target.selector}`,
    target.textSnippet ? `Text: ${oneLine(target.textSnippet, 200)}` : "",
    target.htmlPreview ? `HTML: ${oneLine(target.htmlPreview, 400)}` : "",
    target.styles ? `Styles:\n${target.styles.split("\n").map((line) => `  ${line}`).join("\n")}` : "",
  ]
  if (thread.changes?.length) {
    lines.push("Requested style changes:")
    for (const change of thread.changes) {
      lines.push(`  ${change.property}: ${change.from} → ${change.to}${change.token ? `  (token ${change.token})` : ""}`)
    }
  }
  lines.push("Messages:")
  for (const message of thread.messages) {
    lines.push(`  [${message.role === "agent" ? "agent" : "user"} ${new Date(message.createdAt).toISOString()}] ${message.text}`)
  }
  if (thread.status === "resolved") {
    lines.push(`Resolved${thread.resolvedBy ? ` by ${thread.resolvedBy}` : ""}${thread.resolution ? `: ${thread.resolution}` : ""}`)
  }
  return lines.filter(Boolean).join("\n")
}

const createId = () => `comment-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const readInstructions = () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const candidate of [path.join(here, "AGENT.md"), path.join(here, "..", "bridge", "AGENT.md")]) {
    try {
      return readFileSync(candidate, "utf8")
    } catch {
      // try the next place
    }
  }
  return "See https://github.com/purduehackers/mesurer/blob/main/packages/mesurer/bridge/AGENT.md"
}

export const run = async (argv: string[]) => {
  const { flags, positional } = parseArgs(argv)
  const [group, command, id, ...rest] = positional
  if (!group || group === "help" || (group === "comments" && (!command || command === "help"))) {
    console.log(USAGE)
    return 0
  }
  if (group !== "comments") {
    console.error(`Unknown command "${group}".\n\n${USAGE}`)
    return 1
  }
  if (command === "instructions") {
    console.log(readInstructions())
    return 0
  }
  const store = createCommentsStore({ root: flags.root, file: flags.file })

  if (command === "list") {
    const document = await store.read()
    if (flags.json) {
      console.log(JSON.stringify(document.threads.filter((thread) => flags.all || thread.status === "open"), null, 2))
    } else {
      console.log(formatList(document, flags.all))
    }
    return 0
  }

  if (!id) {
    console.error(`"${command}" needs a comment id.\n\n${USAGE}`)
    return 1
  }

  if (command === "show") {
    const found = findThread((await store.read()).threads, id)
    if (!found.thread) {
      console.error(found.error)
      return 1
    }
    console.log(flags.json ? JSON.stringify(found.thread, null, 2) : formatThread(found.thread))
    return 0
  }

  const text = rest.join(" ").trim()
  if (command === "reply" && !text) {
    console.error("reply needs the text of the reply.")
    return 1
  }
  if (command !== "reply" && command !== "resolve" && command !== "reopen") {
    console.error(`Unknown command "${command}".\n\n${USAGE}`)
    return 1
  }

  let error: string | undefined
  let changed: BridgeThread | undefined
  await store.update((document) => {
    const found = findThread(document.threads, id)
    if (!found.thread) {
      error = found.error
      return document
    }
    const now = Date.now()
    const thread = found.thread
    let next: BridgeThread
    if (command === "reply") {
      next = {
        ...thread,
        messages: [...thread.messages, { id: createId(), role: "agent", text, createdAt: now }],
        updatedAt: now,
      }
    } else if (command === "resolve") {
      next = {
        ...thread,
        status: "resolved",
        resolvedAt: now,
        resolvedBy: "agent",
        ...(text ? { resolution: text } : {}),
        updatedAt: now,
      }
      if (!text) delete next.resolution
    } else {
      const { resolvedAt: _at, resolvedBy: _by, resolution: _note, ...open } = thread
      next = { ...open, status: "open", updatedAt: now }
    }
    changed = next
    return { ...document, threads: document.threads.map((item) => (item.id === thread.id ? next : item)) }
  })
  if (error) {
    console.error(error)
    return 1
  }
  if (changed) {
    const verb = command === "reply" ? "Replied to" : command === "resolve" ? "Resolved" : "Reopened"
    console.log(`${verb} ${changed.id}`)
  }
  return 0
}
