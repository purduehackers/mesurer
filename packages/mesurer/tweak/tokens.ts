import { parsePx, type TokenCategory } from "./properties"

// The page's design tokens: the custom properties it sets on :root (Tailwind v4's @theme, shadcn's
// variables, any design system's), sorted by what they are for, so a tweak can snap to them and
// say `var(--radius-lg)` instead of `12px`.

export type Token = {
  /** As shown and handed to the agent: `--radius-lg`, or `--spacing * 4` for Tailwind's scale. */
  name: string
  /** What is written in the preview: `var(--radius-lg)`, `calc(var(--spacing) * 4)`. */
  value: string
  /** The resolved size in px, for lengths and weights. */
  px?: number
}

export type TokenSet = Partial<Record<TokenCategory, Token[]>>

/** Tailwind v4's spacing scale: `p-4` is `calc(var(--spacing) * 4)`. */
export const TAILWIND_SPACING_STEPS = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44,
  48, 52, 56, 60, 64, 72, 80, 96,
]

const HSL_COMPONENTS = /^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/

/** Which kind of token a custom property is, from its name and value; null when none. */
export const classifyToken = (name: string, value: string): TokenCategory | null => {
  const raw = value.trim()
  if (!raw) return null
  // Tailwind's per-size companions (`--text-sm--line-height`) are not tokens of their own.
  if (name.slice(2).includes("--")) return null
  if (/^--(color|colors)-/.test(name)) return "color"
  if (/^--(radius|rounded)(-|$)/.test(name)) return "radius"
  if (/^--(text|font-size|fs)-/.test(name)) return "fontSize"
  if (/^--font-weight-/.test(name)) return "fontWeight"
  if (/^--(leading|line-height)-/.test(name)) return "lineHeight"
  if (/^--(tracking|letter-spacing)-/.test(name)) return "letterSpacing"
  if (/^--(spacing|space|gap)(-|$)/.test(name)) return "spacing"
  // shadcn and others name colors by role (`--primary`, `--muted-foreground`).
  if (HSL_COMPONENTS.test(raw)) return "color"
  if (/^(#[\da-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\()/i.test(raw)) return "color"
  return null
}

/** What to write for a token: `hsl(var(--x))` for shadcn's bare HSL components. */
export const tokenValue = (name: string, raw: string) =>
  HSL_COMPONENTS.test(raw.trim()) ? `hsl(var(${name}))` : `var(${name})`

type RuleList = { cssRules: CSSRuleList }

const isRootSelector = (selector: string) =>
  selector.split(",").some((part) => /^\s*(:root|:host|html)\s*$/.test(part))

// Custom property names set on the root, in stylesheet order, from @layer and @media blocks too.
const collectRootProperties = (list: RuleList, names: Set<string>) => {
  let rules: CSSRuleList
  try {
    rules = list.cssRules
  } catch {
    return // another origin's stylesheet
  }
  for (const rule of Array.from(rules)) {
    const style = (rule as CSSStyleRule).style
    const selector = (rule as CSSStyleRule).selectorText
    if (style && typeof selector === "string") {
      if (!isRootSelector(selector)) continue
      for (let index = 0; index < style.length; index++) {
        const name = style.item(index)
        if (name.startsWith("--")) names.add(name)
      }
    } else if ("cssRules" in rule) {
      collectRootProperties(rule as unknown as RuleList, names)
    }
  }
}

export const scanTokens = (ownerDocument: Document): TokenSet => {
  const view = ownerDocument.defaultView
  if (!view) return {}
  const names = new Set<string>()
  for (const sheet of Array.from(ownerDocument.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.hasAttribute?.("data-mesurer-tweak")) continue
    collectRootProperties(sheet, names)
  }
  const rootStyle = view.getComputedStyle(ownerDocument.documentElement)
  // Lengths are resolved in px by putting each token on a probe.
  const probe = ownerDocument.createElement("div")
  probe.setAttribute("aria-hidden", "true")
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;"
  ownerDocument.body.appendChild(probe)
  const measure = (property: string, value: string) => {
    probe.style.setProperty(property, value)
    const result = view.getComputedStyle(probe).getPropertyValue(property)
    probe.style.removeProperty(property)
    return result
  }
  const tokens: TokenSet = {}
  const add = (category: TokenCategory, token: Token) => {
    ;(tokens[category] ??= []).push(token)
  }
  try {
    for (const name of names) {
      const raw = rootStyle.getPropertyValue(name).trim()
      const category = classifyToken(name, raw)
      if (!category) continue
      // Tailwind v4 has one spacing unit and a scale of multiples of it.
      if (name === "--spacing" && category === "spacing") {
        for (const step of TAILWIND_SPACING_STEPS) {
          const value = `calc(var(--spacing) * ${step})`
          add("spacing", { name: `--spacing * ${step}`, value, px: parsePx(measure("width", value)) ?? undefined })
        }
        continue
      }
      const value = tokenValue(name, raw)
      if (category === "color") {
        add("color", { name, value })
      } else if (category === "fontWeight") {
        const weight = Number(measure("font-weight", value))
        add(category, { name, value, px: Number.isFinite(weight) ? weight : undefined })
      } else {
        // Line heights given as a ratio (`--leading-tight: 1.25`) are kept as written.
        const px = parsePx(measure(category === "letterSpacing" ? "letter-spacing" : "width", value))
        if (px === null && category !== "lineHeight") continue
        add(category, { name, value, px: px ?? undefined })
      }
    }
  } finally {
    probe.remove()
  }
  for (const list of Object.values(tokens)) {
    if (list[0]?.px !== undefined) list.sort((a, b) => (a.px ?? 0) - (b.px ?? 0))
  }
  return tokens
}

/**
 * The next token up or down from `px` (sizes), or from `current` (the token in use, for colors and
 * anything without a size). Null when there is none further that way.
 */
export const stepToken = (
  tokens: Token[],
  direction: 1 | -1,
  px: number | null,
  current?: string,
): Token | null => {
  if (tokens.length === 0) return null
  const index = current ? tokens.findIndex((token) => token.name === current) : -1
  if (index !== -1) return tokens[index + direction] ?? null
  if (px === null || tokens[0].px === undefined) return direction === 1 ? tokens[0] : tokens[tokens.length - 1]
  // From a value between tokens, the nearest one in that direction.
  const sized = tokens.filter((token) => token.px !== undefined)
  if (direction === 1) return sized.find((token) => (token.px as number) > px + 0.01) ?? null
  return [...sized].reverse().find((token) => (token.px as number) < px - 0.01) ?? null
}

/** The token whose size is `px`, if one is (for showing which token a value already is). */
export const matchToken = (tokens: Token[] | undefined, px: number | null) =>
  px === null ? undefined : tokens?.find((token) => token.px !== undefined && Math.abs(token.px - px) < 0.01)
