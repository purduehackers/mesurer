// What the Tweak tool can change on an element, and how a value steps up or down.
import { parseCssColor } from "../core/colors"

export type TweakGroup = "Size" | "Spacing" | "Radius" | "Text" | "Color" | "Effects"
export type TokenCategory =
  | "spacing"
  | "radius"
  | "fontSize"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "color"

export type TweakKind = "length" | "number" | "weight" | "color" | "scale"

export type TweakProperty = {
  id: string
  label: string
  group: TweakGroup
  /** The CSS properties it writes; all take the same value. Empty for scale. */
  css: string[]
  kind: TweakKind
  step: number
  min?: number
  max?: number
  tokens?: TokenCategory
}

export const TWEAK_PROPERTIES: TweakProperty[] = [
  { id: "scale", label: "Scale", group: "Size", css: [], kind: "scale", step: 0.05, min: 0.1, max: 10 },
  { id: "padding-y", label: "Padding Y", group: "Spacing", css: ["padding-top", "padding-bottom"], kind: "length", step: 1, min: 0, tokens: "spacing" },
  { id: "padding-x", label: "Padding X", group: "Spacing", css: ["padding-left", "padding-right"], kind: "length", step: 1, min: 0, tokens: "spacing" },
  { id: "margin-top", label: "Margin top", group: "Spacing", css: ["margin-top"], kind: "length", step: 1, tokens: "spacing" },
  { id: "margin-bottom", label: "Margin bottom", group: "Spacing", css: ["margin-bottom"], kind: "length", step: 1, tokens: "spacing" },
  { id: "gap", label: "Gap", group: "Spacing", css: ["gap"], kind: "length", step: 1, min: 0, tokens: "spacing" },
  { id: "border-radius", label: "Radius", group: "Radius", css: ["border-radius"], kind: "length", step: 1, min: 0, tokens: "radius" },
  { id: "font-size", label: "Font size", group: "Text", css: ["font-size"], kind: "length", step: 1, min: 1, tokens: "fontSize" },
  { id: "font-weight", label: "Weight", group: "Text", css: ["font-weight"], kind: "weight", step: 100, min: 100, max: 900, tokens: "fontWeight" },
  { id: "line-height", label: "Line height", group: "Text", css: ["line-height"], kind: "length", step: 1, min: 0, tokens: "lineHeight" },
  { id: "letter-spacing", label: "Letter spacing", group: "Text", css: ["letter-spacing"], kind: "length", step: 0.1, tokens: "letterSpacing" },
  { id: "color", label: "Text", group: "Color", css: ["color"], kind: "color", step: 2, tokens: "color" },
  { id: "background-color", label: "Background", group: "Color", css: ["background-color"], kind: "color", step: 2, tokens: "color" },
  { id: "border-color", label: "Border", group: "Color", css: ["border-color"], kind: "color", step: 2, tokens: "color" },
  { id: "opacity", label: "Opacity", group: "Effects", css: ["opacity"], kind: "number", step: 0.05, min: 0, max: 1 },
]

/** What scale multiplies: everything that makes the element bigger or smaller together. */
export const SCALED_PROPERTIES = [
  "font-size",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "border-radius",
  "line-height",
]

const round = (value: number, places = 2) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** A computed length in px, or null when it is not one ("normal", "auto"). */
export const parsePx = (value: string): number | null => {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim())
  return match ? Number(match[1]) : null
}

export const formatPx = (value: number) => `${round(value)}px`

/** The value one step up (`direction` 1) or down (-1), `big` stepping ten times as far. */
export const stepValue = (
  property: TweakProperty,
  current: string,
  direction: 1 | -1,
  big = false,
): string | null => {
  const step = property.step * (big ? 10 : 1) * direction
  const clamp = (value: number) =>
    Math.min(property.max ?? Infinity, Math.max(property.min ?? -Infinity, value))
  if (property.kind === "length") {
    // "normal" letter spacing and line height start from 0 and from 1.2 × the font size.
    const px = parsePx(current) ?? (current === "normal" ? 0 : null)
    if (px === null) return null
    return formatPx(clamp(round(px + step)))
  }
  if (property.kind === "weight") {
    const weight = Number(current)
    if (!Number.isFinite(weight)) return null
    return String(clamp(Math.round((weight + step) / 100) * 100))
  }
  if (property.kind === "number" || property.kind === "scale") {
    const value = Number(current)
    if (!Number.isFinite(value)) return null
    return String(clamp(round(value + step)))
  }
  return null
}

/** A value multiplied by `factor`, for each scaled property; null when it is not a length. */
export const scaleValue = (value: string, factor: number) => {
  const px = parsePx(value)
  return px === null ? null : formatPx(px * factor)
}

/**
 * A color made lighter (`direction` 1) or darker (-1) by `amount` percent of lightness. Colors the
 * page wrote in oklch (Tailwind v4's palette) step in oklch, so hue and chroma stay put.
 */
export const stepColor = (value: string, direction: 1 | -1, amount = 2): string | null => {
  const oklch = /^oklch\(\s*(-?[\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+|none)\s*(\/\s*[\d.]+%?)?\s*\)$/i.exec(value.trim())
  if (oklch) {
    const percent = oklch[2] === "%"
    const lightness = Number(oklch[1]) / (percent ? 100 : 1)
    const next = Math.min(1, Math.max(0, round(lightness + (direction * amount) / 100, 3)))
    const alpha = oklch[5] ? ` ${oklch[5].replace(/\s+/g, " ")}` : ""
    return `oklch(${next} ${oklch[3]} ${oklch[4]}${alpha})`
  }
  const color = parseCssColor(value)
  if (!color) return null
  const red = color.red / 255
  const green = color.green / 255
  const blue = color.blue / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  let hue = 0
  let saturation = 0
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1))
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue *= 60
    if (hue < 0) hue += 360
  }
  const nextLightness = Math.min(100, Math.max(0, lightness * 100 + direction * amount))
  const alpha = color.alpha >= 0.999 ? "" : ` / ${round(color.alpha, 3)}`
  return `hsl(${round(hue, 1)} ${round(saturation * 100, 1)}% ${round(nextLightness, 1)}%${alpha})`
}
