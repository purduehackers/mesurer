import { describe, expect, it } from "vitest"
import { stepColor, stepValue, scaleValue, TWEAK_PROPERTIES } from "./properties"
import { classifyToken, stepToken, tokenValue, type Token } from "./tokens"

const property = (id: string) => TWEAK_PROPERTIES.find((item) => item.id === id)!

describe("stepValue", () => {
  it("steps lengths by 1px, or 10px with shift, never below the minimum", () => {
    expect(stepValue(property("padding-x"), "16px", 1)).toBe("17px")
    expect(stepValue(property("padding-x"), "16px", -1, true)).toBe("6px")
    expect(stepValue(property("padding-x"), "4px", -1, true)).toBe("0px")
  })
  it("starts normal letter spacing from 0", () => {
    expect(stepValue(property("letter-spacing"), "normal", 1)).toBe("0.1px")
  })
  it("steps weights by 100 between 100 and 900", () => {
    expect(stepValue(property("font-weight"), "400", 1)).toBe("500")
    expect(stepValue(property("font-weight"), "900", 1)).toBe("900")
  })
  it("steps opacity between 0 and 1", () => {
    expect(stepValue(property("opacity"), "1", 1)).toBe("1")
    expect(stepValue(property("opacity"), "1", -1)).toBe("0.95")
  })
  it("leaves values it cannot read alone", () => {
    expect(stepValue(property("line-height"), "auto", 1)).toBeNull()
  })
})

describe("scaleValue", () => {
  it("multiplies px lengths", () => {
    expect(scaleValue("16px", 1.25)).toBe("20px")
    expect(scaleValue("normal", 2)).toBeNull()
  })
})

describe("stepColor", () => {
  it("steps oklch lightness and keeps hue and chroma", () => {
    expect(stepColor("oklch(0.5 0.2 250)", 1)).toBe("oklch(0.52 0.2 250)")
    expect(stepColor("oklch(50% 0.2 250 / 0.5)", -1)).toBe("oklch(0.48 0.2 250 / 0.5)")
  })
  it("steps rgb in hsl lightness", () => {
    expect(stepColor("rgb(255, 0, 0)", -1)).toBe("hsl(0 100% 48%)")
  })
})

describe("classifyToken", () => {
  it("sorts Tailwind v4 theme variables", () => {
    expect(classifyToken("--spacing", "0.25rem")).toBe("spacing")
    expect(classifyToken("--radius-lg", "0.5rem")).toBe("radius")
    expect(classifyToken("--text-sm", "0.875rem")).toBe("fontSize")
    expect(classifyToken("--text-sm--line-height", "1.4")).toBeNull()
    expect(classifyToken("--font-weight-bold", "700")).toBe("fontWeight")
    expect(classifyToken("--color-red-500", "oklch(63.7% 0.237 25.331)")).toBe("color")
    expect(classifyToken("--tracking-tight", "-0.025em")).toBe("letterSpacing")
    expect(classifyToken("--leading-tight", "1.25")).toBe("lineHeight")
  })
  it("sorts shadcn's variables, old and new", () => {
    expect(classifyToken("--primary", "222.2 47.4% 11.2%")).toBe("color")
    expect(tokenValue("--primary", "222.2 47.4% 11.2%")).toBe("hsl(var(--primary))")
    expect(classifyToken("--primary", "oklch(0.205 0 0)")).toBe("color")
    expect(classifyToken("--radius", "0.625rem")).toBe("radius")
  })
  it("ignores what is not a token", () => {
    expect(classifyToken("--tw-ring-offset", "0px")).toBeNull()
    expect(classifyToken("--ease-out", "cubic-bezier(0, 0, 0.2, 1)")).toBeNull()
  })
})

describe("stepToken", () => {
  const sizes: Token[] = [
    { name: "--a", value: "var(--a)", px: 4 },
    { name: "--b", value: "var(--b)", px: 8 },
    { name: "--c", value: "var(--c)", px: 16 },
  ]
  it("goes to the nearest token in the direction from a value between tokens", () => {
    expect(stepToken(sizes, 1, 10)?.name).toBe("--c")
    expect(stepToken(sizes, -1, 10)?.name).toBe("--b")
  })
  it("goes past the token the value already is", () => {
    expect(stepToken(sizes, 1, 8)?.name).toBe("--c")
    expect(stepToken(sizes, 1, 8, "--b")?.name).toBe("--c")
    expect(stepToken(sizes, 1, 16)).toBeNull()
  })
  it("walks colors in order", () => {
    const colors: Token[] = [{ name: "--x", value: "var(--x)" }, { name: "--y", value: "var(--y)" }]
    expect(stepToken(colors, 1, null)?.name).toBe("--x")
    expect(stepToken(colors, 1, null, "--x")?.name).toBe("--y")
  })
})
