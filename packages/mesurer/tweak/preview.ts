// Tweaks shown on the page before they are made for real: a stylesheet of Mesurer's own, one rule
// per tweak, with `!important` so it wins over the page's classes. A stylesheet and not inline
// styles, because a framework re-rendering the element would wipe those.

export type PreviewDeclarations = Record<string, string>

const ATTRIBUTE = "data-mesurer-tweak"

export type PreviewSheet = {
  set: (key: string, selector: string, declarations: PreviewDeclarations) => void
  remove: (key: string) => void
  has: (key: string) => boolean
  keys: () => string[]
  /** Turns the whole sheet off (to show "before", or to read the page's own values) or on. */
  setEnabled: (enabled: boolean) => void
  /** Runs `read` with one rule off, for reading what the page alone gives. */
  without: <T>(key: string, read: () => T) => T
  destroy: () => void
}

const sheets = new WeakMap<Document, PreviewSheet>()

export const getPreviewSheet = (ownerDocument: Document): PreviewSheet => {
  const existing = sheets.get(ownerDocument)
  if (existing) return existing
  const rules = new Map<string, string>()
  let disabled = new Set<string>()
  let enabled = true
  let element: HTMLStyleElement | null = null

  const render = () => {
    if (!element || !element.isConnected) {
      element = ownerDocument.createElement("style")
      element.setAttribute(ATTRIBUTE, "")
      // Last in the head, so it comes after the page's own stylesheets.
      ;(ownerDocument.head ?? ownerDocument.documentElement).appendChild(element)
    }
    element.textContent = enabled
      ? [...rules].filter(([key]) => !disabled.has(key)).map(([, rule]) => rule).join("\n")
      : ""
  }

  const sheet: PreviewSheet = {
    set: (key, selector, declarations) => {
      const body = Object.entries(declarations)
        .map(([property, value]) => `${property}: ${value} !important;`)
        .join(" ")
      if (!body) {
        rules.delete(key)
      } else {
        rules.set(key, `${selector} { ${body} }`)
      }
      render()
    },
    remove: (key) => {
      if (!rules.delete(key)) return
      render()
    },
    has: (key) => rules.has(key),
    keys: () => [...rules.keys()],
    setEnabled: (value) => {
      if (enabled === value) return
      enabled = value
      render()
    },
    without: (key, read) => {
      if (!rules.has(key)) return read()
      disabled = new Set([...disabled, key])
      render()
      try {
        return read()
      } finally {
        disabled.delete(key)
        render()
      }
    },
    destroy: () => {
      element?.remove()
      element = null
      rules.clear()
      sheets.delete(ownerDocument)
    },
  }
  sheets.set(ownerDocument, sheet)
  return sheet
}

const escape = (value: string) =>
  typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/([^\w-])/g, "\\$1")

/** Every element with the same tag and classes as this one; its own selector when it has none. */
export const getClassSelector = (element: Element, fallback: string) => {
  const classes = Array.from(element.classList).filter((name) => !name.startsWith("mesurer"))
  if (classes.length === 0) return fallback
  return `${element.tagName.toLowerCase()}${classes.map((name) => `.${escape(name)}`).join("")}`
}
