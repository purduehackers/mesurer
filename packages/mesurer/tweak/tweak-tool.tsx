import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react"
import { addMesurerCaptureListener } from "../core/keyboard-gate"
import { getTargetElement } from "../core/selection"
import { getElementSelector } from "../core/selector"
import type { CommentThread, Rect, StyleChange } from "../core/types"
import { getSourceHint } from "../comments/dom"
import {
  parsePx,
  scaleValue,
  SCALED_PROPERTIES,
  stepColor,
  stepValue,
  TWEAK_PROPERTIES,
  type TweakProperty,
} from "./properties"
import { getClassSelector, getPreviewSheet, type PreviewDeclarations } from "./preview"
import { matchToken, scanTokens, stepToken, type TokenSet } from "./tokens"

// The Tweak tool: pick an element, nudge its spacing, radius, type and colors with the keyboard,
// see it live, and save the result as a comment of exact style changes for an agent to make in
// the source. Until the source catches up, the saved changes stay previewed on the page.

export type TweakSaveInput = {
  element: Element
  changes: StyleChange[]
  note: string
}

export type TweakToolProps = {
  active: boolean
  ownerDocument: Document
  ownerWindow: Window
  overlayRef: RefObject<HTMLDivElement | null>
  highlightColor: string
  comments: CommentThread[]
  /** Saves the tweak as a comment thread, and gives its id. */
  onSave: (input: TweakSaveInput) => string | null
  /** Set while the tool is using the keyboard, so Mesurer's own shortcuts stand back. */
  keyboardOwnedRef: MutableRefObject<boolean>
}

type Edit = { value: string; token?: string }

const EDITING_KEY = "editing"
const threadKey = (id: string) => `thread:${id}`
const CHECK_INTERVAL_MS = 1500

const isEditable = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return Boolean(element?.closest?.("input, textarea, select, [contenteditable='true']"))
}

const inMesurer = (event: Event) =>
  event.composedPath().some((node) => (node as Element).hasAttribute?.("data-mesurer-root"))

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)

const toRect = (element: Element): Rect => {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

const describeElement = (element: Element) => {
  const classes = Array.from(element.classList).slice(0, 3).map((name) => `.${name}`).join("")
  return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes}`
}

/** One line saying what changed, for the thread's message when no note is given. */
export const summarizeChanges = (changes: StyleChange[]) =>
  `Tweak: ${changes.map((change) => `${change.property} ${change.from} → ${change.token ?? change.to}`).join(", ")}`

// The properties worth offering for this element: gap only where there is a layout that uses it.
const propertiesFor = (style: CSSStyleDeclaration) =>
  TWEAK_PROPERTIES.filter((property) => {
    if (property.id === "gap") return /flex|grid/.test(style.display)
    if (property.id === "border-color") return parseFloat(style.borderTopWidth) > 0
    return true
  })

export function TweakTool({
  active,
  ownerDocument,
  ownerWindow,
  overlayRef,
  highlightColor,
  comments,
  onSave,
  keyboardOwnedRef,
}: TweakToolProps) {
  const sheet = useMemo(() => getPreviewSheet(ownerDocument), [ownerDocument])
  const [hover, setHover] = useState<Element | null>(null)
  const [selected, setSelected] = useState<Element | null>(null)
  const [hoverRect, setHoverRect] = useState<Rect | null>(null)
  const [selectedRect, setSelectedRect] = useState<Rect | null>(null)
  const [original, setOriginal] = useState<Record<string, string>>({})
  const [properties, setProperties] = useState<TweakProperty[]>(TWEAK_PROPERTIES)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [cursor, setCursor] = useState(0)
  const [tokens, setTokens] = useState<TokenSet>({})
  const [tokenMode, setTokenMode] = useState(true)
  const [sameClass, setSameClass] = useState(false)
  const [before, setBefore] = useState(false)
  const [note, setNote] = useState("")
  const [saved, setSaved] = useState(false)
  const landedRef = useRef(new Set<string>())

  const selector = useMemo(() => {
    if (!selected) return ""
    const own = getElementSelector(selected)
    return sameClass ? getClassSelector(selected, own) : own
  }, [sameClass, selected])

  const hasTokens = Object.keys(tokens).length > 0

  // ---- What is being changed, as CSS ------------------------------------------------------

  const declarations = useMemo((): PreviewDeclarations => {
    const result: PreviewDeclarations = {}
    for (const property of TWEAK_PROPERTIES) {
      const edit = edits[property.id]
      if (!edit || property.kind === "scale") continue
      for (const css of property.css) result[css] = edit.value
    }
    const factor = Number(edits.scale?.value ?? 1)
    if (Number.isFinite(factor) && factor !== 1) {
      for (const css of SCALED_PROPERTIES) {
        // An explicit edit is scaled too, unless it is a token (kept as the token).
        const base = result[css] && !result[css].includes("var(") ? result[css] : original[css]
        const scaled = base ? scaleValue(base, factor) : null
        if (scaled) result[css] = scaled
      }
    }
    return result
  }, [edits, original])

  useLayoutEffect(() => {
    if (!selected || Object.keys(declarations).length === 0) {
      sheet.remove(EDITING_KEY)
      return
    }
    sheet.set(EDITING_KEY, selector, declarations)
  }, [declarations, selected, selector, sheet])

  useEffect(() => {
    sheet.setEnabled(!before)
  }, [before, sheet])

  // ---- Choosing an element ----------------------------------------------------------------

  const readOriginal = useCallback(
    (element: Element) =>
      sheet.without(EDITING_KEY, () => {
        const style = ownerWindow.getComputedStyle(element)
        const values: Record<string, string> = {}
        for (const property of TWEAK_PROPERTIES) {
          for (const css of property.css) values[css] = style.getPropertyValue(css)
        }
        for (const css of SCALED_PROPERTIES) values[css] = style.getPropertyValue(css)
        return { values, properties: propertiesFor(style) }
      }),
    [ownerWindow, sheet],
  )

  const select = useCallback(
    (element: Element | null) => {
      setEdits({})
      setNote("")
      setSaved(false)
      setBefore(false)
      setSelected(element)
      if (!element) return
      const read = readOriginal(element)
      setOriginal(read.values)
      setProperties(read.properties)
      setCursor((index) => Math.min(index, read.properties.length - 1))
    },
    [readOriginal],
  )

  useEffect(() => {
    if (active) {
      setTokens(scanTokens(ownerDocument))
      return
    }
    select(null)
    setHover(null)
    setBefore(false)
  }, [active, ownerDocument, select])

  useEffect(() => {
    if (!active) return
    let frame = 0
    const pointAt = (event: MouseEvent) => ({ x: event.clientX, y: event.clientY })
    const onMove = (event: PointerEvent) => {
      if (inMesurer(event)) {
        setHover(null)
        return
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setHover(getTargetElement(pointAt(event), overlayRef.current, ownerDocument)))
    }
    // The page does not get the press: a link is not followed, a button not pressed.
    const swallow = (event: Event) => {
      if (inMesurer(event) || (event as MouseEvent).button > 0) return
      event.preventDefault()
      event.stopPropagation()
    }
    const onClick = (event: MouseEvent) => {
      if (inMesurer(event) || event.button > 0) return
      event.preventDefault()
      event.stopPropagation()
      const target = getTargetElement(pointAt(event), overlayRef.current, ownerDocument)
      if (target) select(target)
    }
    ownerDocument.addEventListener("pointermove", onMove, true)
    ownerDocument.addEventListener("pointerdown", swallow, true)
    ownerDocument.addEventListener("mousedown", swallow, true)
    ownerDocument.addEventListener("pointerup", swallow, true)
    ownerDocument.addEventListener("mouseup", swallow, true)
    ownerDocument.addEventListener("click", onClick, true)
    return () => {
      cancelAnimationFrame(frame)
      ownerDocument.removeEventListener("pointermove", onMove, true)
      ownerDocument.removeEventListener("pointerdown", swallow, true)
      ownerDocument.removeEventListener("mousedown", swallow, true)
      ownerDocument.removeEventListener("pointerup", swallow, true)
      ownerDocument.removeEventListener("mouseup", swallow, true)
      ownerDocument.removeEventListener("click", onClick, true)
    }
  }, [active, overlayRef, ownerDocument, select])

  // Boxes follow their elements through scrolling, resizing and the preview itself.
  useEffect(() => {
    if (!active || (!hover && !selected)) {
      setHoverRect(null)
      setSelectedRect(null)
      return
    }
    let frame = 0
    const tick = () => {
      const nextHover = hover && hover !== selected && hover.isConnected ? toRect(hover) : null
      const nextSelected = selected?.isConnected ? toRect(selected) : null
      setHoverRect((previous) => (sameRect(previous, nextHover) ? previous : nextHover))
      setSelectedRect((previous) => (sameRect(previous, nextSelected) ? previous : nextSelected))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [active, hover, selected])

  // ---- Changing values --------------------------------------------------------------------

  const currentValue = useCallback(
    (property: TweakProperty) =>
      edits[property.id]?.value ?? (property.kind === "scale" ? "1" : original[property.css[0]] ?? ""),
    [edits, original],
  )

  // Token values are read off the element as previewed, for the next step from a token.
  const resolvedPx = useCallback(
    (property: TweakProperty) => {
      if (!selected || property.kind === "scale" || property.kind === "color") return null
      const value = ownerWindow.getComputedStyle(selected).getPropertyValue(property.css[0])
      return property.kind === "weight" ? Number(value) : parsePx(value)
    },
    [ownerWindow, selected],
  )

  const nudge = useCallback(
    (direction: 1 | -1, big: boolean) => {
      const property = properties[cursor]
      if (!property || !selected) return
      const list = property.tokens ? tokens[property.tokens] : undefined
      if (tokenMode && list?.length && property.kind !== "scale") {
        const next = stepToken(list, direction, resolvedPx(property), edits[property.id]?.token)
        if (next) setEdits((previous) => ({ ...previous, [property.id]: { value: next.value, token: next.name } }))
        return
      }
      const current = property.kind === "color"
        ? ownerWindow.getComputedStyle(selected).getPropertyValue(property.css[0])
        : edits[property.id]?.token
          ? ownerWindow.getComputedStyle(selected).getPropertyValue(property.css[0])
          : currentValue(property)
      const next = property.kind === "color"
        ? stepColor(current, direction, big ? 10 : 2)
        : stepValue(property, current, direction, big)
      if (next) setEdits((previous) => ({ ...previous, [property.id]: { value: next } }))
    },
    [currentValue, cursor, edits, ownerWindow, properties, resolvedPx, selected, tokenMode, tokens],
  )

  const setValue = useCallback((property: TweakProperty, value: string) => {
    setEdits((previous) => ({ ...previous, [property.id]: { value } }))
  }, [])

  const revert = useCallback(() => {
    setEdits({})
    setBefore(false)
  }, [])

  const save = useCallback(() => {
    if (!selected || Object.keys(declarations).length === 0) return
    const style = ownerWindow.getComputedStyle(selected)
    const tokenFor = (css: string) => {
      if (Number(edits.scale?.value ?? 1) !== 1) return undefined
      const property = TWEAK_PROPERTIES.find((item) => item.css.includes(css))
      return property ? edits[property.id]?.token : undefined
    }
    const changes: StyleChange[] = Object.entries(declarations)
      .map(([css, to]) => ({
        property: css,
        from: original[css] ?? "",
        to,
        computed: style.getPropertyValue(css),
        selector,
        ...(tokenFor(css) ? { token: tokenFor(css) } : {}),
      }))
      .filter((change) => change.computed !== change.from)
    if (changes.length === 0) {
      revert()
      return
    }
    const id = onSave({ element: selected, changes, note: note.trim() || summarizeChanges(changes) })
    if (!id) return
    // The saved changes stay on the page, under the thread, until the source has them.
    sheet.set(threadKey(id), selector, Object.fromEntries(changes.map((change) => [change.property, change.to])))
    setEdits({})
    setNote("")
    setSaved(true)
    setOriginal(readOriginal(selected).values)
  }, [declarations, edits, note, onSave, original, ownerWindow, readOriginal, revert, selected, selector, sheet])

  // ---- Keyboard ---------------------------------------------------------------------------

  const ownsKeyboard = active && selected !== null
  keyboardOwnedRef.current = ownsKeyboard

  useEffect(() => {
    if (!ownsKeyboard) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditable(event.target) || isEditable(ownerDocument.activeElement)) return
      const handled = (() => {
        switch (event.key) {
          // The properties are a vertical list: ↑/↓ move between them, ←/→ change the value.
          case "ArrowUp":
          case "ArrowDown":
            setCursor((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + properties.length) % properties.length)
            return true
          case "ArrowLeft":
          case "ArrowRight":
            nudge(event.key === "ArrowRight" ? 1 : -1, event.shiftKey)
            return true
          case "t":
          case "T":
            if (hasTokens) setTokenMode((value) => !value)
            return true
          case "a":
          case "A":
            setSameClass((value) => !value)
            return true
          case "b":
          case "B":
            if (!event.repeat) setBefore(true)
            return true
          case "Enter":
            save()
            return true
          case "Escape":
            if (Object.keys(edits).length > 0) revert()
            else select(null)
            return true
          default:
            return false
        }
      })()
      if (!handled) return
      event.preventDefault()
      event.stopPropagation()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "b" || event.key === "B") setBefore(false)
    }
    const onBlur = () => setBefore(false)
    // On the window, as Mesurer's other shortcuts are: its keyboard gate stops keys there on
    // their way to the page while Mesurer has the keyboard.
    const detachKeyDown = addMesurerCaptureListener(ownerWindow, ownerWindow, "keydown", onKeyDown as EventListener)
    const detachKeyUp = addMesurerCaptureListener(ownerWindow, ownerWindow, "keyup", onKeyUp as EventListener)
    ownerWindow.addEventListener("blur", onBlur)
    return () => {
      detachKeyDown()
      detachKeyUp()
      ownerWindow.removeEventListener("blur", onBlur)
    }
  }, [edits, hasTokens, nudge, ownerDocument, ownerWindow, ownsKeyboard, properties.length, revert, save, select])

  useEffect(() => () => {
    keyboardOwnedRef.current = false
  }, [keyboardOwnedRef])

  // ---- Saved tweaks: previewed until the page's own CSS has them -------------------------

  useEffect(() => {
    const tweaks = comments.filter((thread) => thread.changes?.length)
    const check = () => {
      const live = new Set<string>()
      for (const thread of tweaks) {
        const key = threadKey(thread.id)
        const changes = thread.changes ?? []
        const target = changes[0]?.selector ?? thread.target.selector
        if (thread.status === "resolved" || landedRef.current.has(thread.id)) {
          sheet.remove(key)
          continue
        }
        live.add(key)
        if (!sheet.has(key)) sheet.set(key, target, Object.fromEntries(changes.map((change) => [change.property, change.to])))
        let element: Element | null = null
        try {
          element = ownerDocument.querySelector(target)
        } catch {
          element = null
        }
        if (!element) continue
        const landed = sheet.without(key, () => {
          const style = ownerWindow.getComputedStyle(element as Element)
          return changes.every((change) => change.computed !== undefined && style.getPropertyValue(change.property) === change.computed)
        })
        if (landed) {
          landedRef.current.add(thread.id)
          sheet.remove(key)
        }
      }
      for (const key of sheet.keys()) {
        if (key.startsWith("thread:") && !live.has(key)) sheet.remove(key)
      }
    }
    check()
    if (tweaks.length === 0) return
    const timer = ownerWindow.setInterval(check, CHECK_INTERVAL_MS)
    return () => ownerWindow.clearInterval(timer)
  }, [comments, ownerDocument, ownerWindow, sheet])

  useEffect(() => () => sheet.remove(EDITING_KEY), [sheet])

  if (!active) return null

  const source = selected ? getSourceHint(selected) : undefined
  const editCount = Object.keys(declarations).length

  return (
    <>
      {hoverRect ? (
        <div
          data-mesurer-tweak-hover
          className="msr:pointer-events-none msr:fixed msr:rounded-[2px]"
          style={{ ...boxStyle(hoverRect), outline: `1px dashed ${highlightColor}` }}
        />
      ) : null}
      {selectedRect ? (
        <div
          data-mesurer-tweak-selected
          className="msr:pointer-events-none msr:fixed"
          style={{ ...boxStyle(selectedRect), outline: `2px solid ${highlightColor}` }}
        />
      ) : null}
      {selected && selectedRect ? (
        <TweakPanel
          rect={selectedRect}
          ownerWindow={ownerWindow}
          title={describeElement(selected)}
          source={source ? `${source.file}${source.line ? `:${source.line}` : ""}` : undefined}
          properties={properties}
          cursor={cursor}
          edits={edits}
          original={original}
          tokens={tokens}
          tokenMode={tokenMode && hasTokens}
          hasTokens={hasTokens}
          sameClass={sameClass}
          classSelector={getClassSelector(selected, "")}
          before={before}
          note={note}
          saved={saved}
          editCount={editCount}
          currentValue={currentValue}
          resolvedPx={resolvedPx}
          onCursor={setCursor}
          onSetValue={setValue}
          onToggleTokens={() => setTokenMode((value) => !value)}
          onToggleSameClass={() => setSameClass((value) => !value)}
          onNote={setNote}
          onRevert={revert}
          onSave={save}
          onClose={() => select(null)}
        />
      ) : null}
    </>
  )
}

const boxStyle = (rect: Rect) => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
  zIndex: 90,
})

const PANEL_WIDTH = 272

type TweakPanelProps = {
  rect: Rect
  ownerWindow: Window
  title: string
  source?: string
  properties: TweakProperty[]
  cursor: number
  edits: Record<string, Edit>
  original: Record<string, string>
  tokens: TokenSet
  tokenMode: boolean
  hasTokens: boolean
  sameClass: boolean
  classSelector: string
  before: boolean
  note: string
  saved: boolean
  editCount: number
  currentValue: (property: TweakProperty) => string
  resolvedPx: (property: TweakProperty) => number | null
  onCursor: (index: number) => void
  onSetValue: (property: TweakProperty, value: string) => void
  onToggleTokens: () => void
  onToggleSameClass: () => void
  onNote: (note: string) => void
  onRevert: () => void
  onSave: () => void
  onClose: () => void
}

function TweakPanel(props: TweakPanelProps) {
  const { rect, ownerWindow, properties, cursor, edits, original } = props
  const viewportWidth = ownerWindow.innerWidth
  const viewportHeight = ownerWindow.innerHeight
  const roomRight = viewportWidth - (rect.left + rect.width) - 12
  const left = roomRight >= PANEL_WIDTH
    ? rect.left + rect.width + 12
    : rect.left - PANEL_WIDTH - 12 >= 8
      ? rect.left - PANEL_WIDTH - 12
      : Math.max(8, viewportWidth - PANEL_WIDTH - 8)
  const top = Math.min(Math.max(8, rect.top), Math.max(8, viewportHeight - 420))
  let group = ""

  return (
    <div
      data-mesurer-tweak-panel
      data-mesurer-inspector-ui="true"
      role="dialog"
      aria-label="Tweak"
      className="msr:pointer-events-auto msr:fixed msr:flex msr:flex-col msr:rounded-lg msr:bg-surface msr:text-[12px] msr:text-ink-900 msr:shadow-floating"
      // Never past the bottom of the window: the property list scrolls instead.
      style={{ left, top, width: PANEL_WIDTH, maxHeight: viewportHeight - top - 8, zIndex: 95 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="msr:flex msr:items-start msr:gap-2 msr:border-b msr:border-ink-100 msr:px-3 msr:py-2">
        <div className="msr:min-w-0 msr:flex-1">
          <div className="msr:truncate msr:font-mono msr:text-[11px] msr:font-medium" title={props.title}>{props.title}</div>
          {props.source ? <div className="msr:truncate msr:text-[11px] msr:text-ink-500" title={props.source}>{props.source}</div> : null}
        </div>
        <button type="button" aria-label="Close tweak" className="msr:rounded-control msr:px-1 msr:text-ink-500 msr:hover:bg-content/6" onClick={props.onClose}>×</button>
      </div>

      <div className="msr:min-h-0 msr:flex-1 msr:overflow-y-auto msr:py-1" role="listbox" aria-label="Properties">
        {properties.map((property, index) => {
          const header = property.group !== group ? property.group : null
          group = property.group
          const edit = edits[property.id]
          const from = property.kind === "scale" ? "1" : original[property.css[0]] ?? ""
          const tokenList = property.tokens ? props.tokens[property.tokens] : undefined
          const existingToken = !edit && property.kind !== "color" ? matchToken(tokenList, props.resolvedPx(property)) : undefined
          const shown = edit ? edit.token ?? edit.value : from
          const isActive = index === cursor
          return (
            <div key={property.id}>
              {header ? <div className="msr:px-3 msr:pb-0.5 msr:pt-2 msr:text-[10px] msr:font-medium msr:uppercase msr:tracking-wide msr:text-ink-500">{header}</div> : null}
              <div
                role="option"
                aria-selected={isActive}
                data-property={property.id}
                className={`msr:flex msr:h-7 msr:cursor-default msr:items-center msr:gap-2 msr:px-3 ${isActive ? "msr:bg-accent/12" : "msr:hover:bg-content/4"}`}
                onClick={() => props.onCursor(index)}
              >
                <span className={`msr:w-24 msr:flex-none msr:truncate ${isActive ? "msr:font-medium" : "msr:text-ink-700"}`}>{property.label}</span>
                {property.kind === "color" ? (
                  <span aria-hidden="true" className="msr:size-3.5 msr:flex-none msr:rounded-[3px] msr:border msr:border-ink-200" style={{ background: edit?.value ?? from }} />
                ) : null}
                <span className="msr:min-w-0 msr:flex-1 msr:truncate msr:text-right msr:font-mono msr:text-[11px]" title={edit ? `${from} → ${shown}` : shown}>
                  {edit ? (
                    <>
                      <span className="msr:text-ink-500">{shortValue(from)} → </span>
                      <span className="msr:text-accent">{shortValue(shown)}</span>
                    </>
                  ) : (
                    <span className="msr:text-ink-700">{existingToken ? existingToken.name : shortValue(shown)}</span>
                  )}
                </span>
                {property.kind === "color" && isActive ? (
                  <input
                    type="text"
                    aria-label={`${property.label} color`}
                    defaultValue=""
                    placeholder="#hex"
                    className="msr:h-5 msr:w-16 msr:flex-none msr:rounded-control msr:border msr:border-ink-200 msr:bg-surface msr:px-1 msr:font-mono msr:text-[10px] msr:outline-none"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        const value = event.currentTarget.value.trim()
                        if (value && typeof CSS !== "undefined" && CSS.supports("color", value)) props.onSetValue(property, value)
                        event.currentTarget.blur()
                      } else if (event.key === "Escape") {
                        event.currentTarget.blur()
                      }
                      event.stopPropagation()
                    }}
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div className="msr:flex msr:flex-wrap msr:gap-1 msr:border-t msr:border-ink-100 msr:px-3 msr:py-2">
        <ToggleChip label="Tokens" shortcut="T" pressed={props.tokenMode} disabled={!props.hasTokens} onClick={props.onToggleTokens} />
        <ToggleChip
          label={props.classSelector ? "All with classes" : "All with classes (none)"}
          shortcut="A"
          pressed={props.sameClass}
          disabled={!props.classSelector}
          onClick={props.onToggleSameClass}
        />
        {props.before ? <span className="msr:self-center msr:text-[11px] msr:text-ink-500">Showing before</span> : null}
      </div>
      <p className="msr:px-3 msr:text-[10.5px] msr:leading-4 msr:text-ink-500">
        ←→ change · ⇧ ×10 · ↑↓ property · hold B for before
      </p>
      <div className="msr:px-3 msr:pb-3 msr:pt-2">
        <textarea
          aria-label="Note for the agent"
          placeholder="Note for the agent (optional)"
          rows={2}
          value={props.note}
          className="msr:w-full msr:resize-none msr:rounded-control msr:border msr:border-ink-200 msr:bg-surface msr:px-2 msr:py-1 msr:text-[12px] msr:outline-none msr:focus:shadow-[inset_0_0_0_1px_var(--msr-accent)]"
          onChange={(event) => props.onNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              props.onSave()
            } else if (event.key === "Escape") {
              event.currentTarget.blur()
            }
            event.stopPropagation()
          }}
        />
        <div className="msr:mt-2 msr:flex msr:items-center msr:justify-end msr:gap-2">
          {props.saved && props.editCount === 0 ? <span data-mesurer-tweak-saved className="msr:mr-auto msr:text-[11px] msr:text-ink-500">Saved as a comment</span> : null}
          <button
            type="button"
            className="msr:h-6 msr:rounded-control msr:border msr:border-ink-200 msr:px-2 msr:text-[11px] msr:text-ink-700 msr:hover:bg-ink-50 msr:disabled:opacity-50"
            disabled={props.editCount === 0}
            onClick={props.onRevert}
          >
            Revert <span className="msr:text-ink-500">Esc</span>
          </button>
          <button
            type="button"
            className="msr:h-6 msr:rounded-control msr:bg-accent msr:px-2 msr:text-[11px] msr:font-medium msr:text-white msr:disabled:opacity-50"
            disabled={props.editCount === 0}
            onClick={props.onSave}
          >
            Save{props.editCount ? ` ${props.editCount}` : ""} <span className="msr:opacity-75">↵</span>
          </button>
        </div>
      </div>
    </div>
  )
}

const shortValue = (value: string) => value.replace(/^calc\(var\(--spacing\) \* ([\d.]+)\)$/, "--spacing * $1")

function ToggleChip({ label, shortcut, pressed, disabled, onClick }: { label: string; shortcut: string; pressed: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      className={`msr:h-6 msr:rounded-control msr:border msr:px-2 msr:text-[11px] msr:disabled:opacity-40 ${pressed ? "msr:border-accent msr:bg-accent/10 msr:text-accent" : "msr:border-ink-200 msr:text-ink-700 msr:hover:bg-ink-50"}`}
      onClick={onClick}
    >
      {label} <span className="msr:opacity-60">{shortcut}</span>
    </button>
  )
}
