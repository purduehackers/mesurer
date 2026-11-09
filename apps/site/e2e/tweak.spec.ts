import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// The Tweak tool: pick an element, nudge values with the keyboard (raw or snapped to the page's
// tokens), see them live, save them as a comment of exact changes, and stop previewing once the
// page's own CSS has them.

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const file = path.join(root, ".mesurer/comments.json");

const readThreads = async () => {
  try {
    return JSON.parse(await readFile(file, "utf8")).threads as Array<Record<string, any>>;
  } catch {
    return [];
  }
};

const startTweak = async (page: Page) => {
  await page.goto("/e2e/fixtures/bridge.html");
  const button = page.getByRole("button", { name: "Tweak (E)" });
  await expect(button).toBeVisible();
  await page.keyboard.press("e");
  await expect(button).toHaveAttribute("aria-pressed", "true");
};

const heading = (page: Page) => page.getByRole("heading", { name: "Merch drop" });
const paddingTop = (page: Page) => heading(page).evaluate((node) => getComputedStyle(node).paddingTop);

test.describe.configure({ mode: "serial" });
test.beforeEach(async () => {
  await rm(file, { force: true });
});

test("nudges padding by pixels and by tokens, saves it, and previews it until the page has it", async ({ page }) => {
  await page.goto("/e2e/fixtures/bridge.html");
  await expect(page.getByRole("button", { name: "Tweak (E)" })).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Tweak (E)" })).toHaveAttribute("aria-pressed", "true");

  // Clicks go to the tool, not the page.
  await page.getByTestId("page-button").click();
  await expect(page.getByTestId("page-button")).toHaveText("Buy");
  await page.keyboard.press("Escape");

  await heading(page).click({ position: { x: 30, y: 20 } });
  const panel = page.getByRole("dialog", { name: "Tweak" });
  await expect(panel).toContainText("h1");
  await expect(panel).toContainText("src/pages/index.astro:12");

  // Scale is first; Padding Y next.
  await page.keyboard.press("ArrowRight");
  await expect(panel.locator('[data-property="padding-y"]')).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("t"); // tokens off
  await page.keyboard.press("ArrowUp");
  expect(await paddingTop(page)).toBe("81px");
  await page.keyboard.press("Shift+ArrowUp");
  expect(await paddingTop(page)).toBe("91px");

  await page.keyboard.press("t"); // tokens on: the next spacing step above 91px is 24 × 4px
  await page.keyboard.press("ArrowUp");
  expect(await paddingTop(page)).toBe("96px");
  await expect(panel.locator('[data-property="padding-y"]')).toContainText("--spacing * 24");

  // Holding B shows the page as it was.
  await page.keyboard.down("b");
  await expect.poll(() => paddingTop(page)).toBe("80px");
  await page.keyboard.up("b");
  await expect.poll(() => paddingTop(page)).toBe("96px");

  await page.getByRole("textbox", { name: "Note for the agent" }).fill("More room above the title");
  await page.getByRole("textbox", { name: "Note for the agent" }).press("Enter");
  await expect(panel.locator("[data-mesurer-tweak-saved]")).toBeVisible();

  await expect.poll(async () => (await readThreads()).length, { timeout: 5000 }).toBe(1);
  const [thread] = await readThreads();
  expect(thread.messages[0].text).toBe("More room above the title");
  expect(thread.target.source.file).toBe("src/pages/index.astro");
  const top = thread.changes.find((change: any) => change.property === "padding-top");
  expect(top).toMatchObject({ from: "80px", to: "calc(var(--spacing) * 24)", token: "--spacing * 24", computed: "96px" });
  expect(thread.changes.map((change: any) => change.property).sort()).toEqual(["padding-bottom", "padding-top"]);

  // Saved, it stays previewed.
  expect(await paddingTop(page)).toBe("96px");

  // The source catches up (as a hot reload would): the preview steps aside.
  await heading(page).evaluate((node) => {
    (node as HTMLElement).style.padding = "96px 40px";
  });
  await expect
    .poll(() => page.locator("style[data-mesurer-tweak]").evaluate((node) => node.textContent ?? ""), { timeout: 5000 })
    .toBe("");
  expect(await paddingTop(page)).toBe("96px");
});

test("Escape reverts, and a color steps lighter", async ({ page }) => {
  await startTweak(page);
  await heading(page).click({ position: { x: 30, y: 20 } });
  const panel = page.getByRole("dialog", { name: "Tweak" });
  await panel.locator('[data-property="background-color"]').click();
  await page.keyboard.press("t"); // tokens off: step lightness
  const background = () => heading(page).evaluate((node) => getComputedStyle(node).backgroundColor);
  const before = await background();
  await page.keyboard.press("ArrowDown");
  await expect.poll(background).not.toBe(before);
  await page.keyboard.press("Escape");
  await expect.poll(background).toBe(before);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("radius snaps to the page's radius tokens", async ({ page }) => {
  await startTweak(page);
  await heading(page).click({ position: { x: 30, y: 20 } });
  const panel = page.getByRole("dialog", { name: "Tweak" });
  await panel.locator('[data-property="border-radius"]').click();
  await page.keyboard.press("ArrowUp");
  await expect(panel.locator('[data-property="border-radius"]')).toContainText("--radius-sm");
  await page.keyboard.press("ArrowUp");
  await expect(panel.locator('[data-property="border-radius"]')).toContainText("--radius-lg");
  expect(await heading(page).evaluate((node) => getComputedStyle(node).borderTopLeftRadius)).toBe("8px");
});

test("scale grows type, padding and radius together", async ({ page }) => {
  await startTweak(page);
  await heading(page).click({ position: { x: 30, y: 20 } });
  const panel = page.getByRole("dialog", { name: "Tweak" });
  await expect(panel.locator('[data-property="scale"]')).toHaveAttribute("aria-selected", "true");
  for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowUp");
  const style = await heading(page).evaluate((node) => {
    const computed = getComputedStyle(node);
    return { fontSize: computed.fontSize, paddingTop: computed.paddingTop, paddingLeft: computed.paddingLeft };
  });
  expect(style).toEqual({ fontSize: "38.4px", paddingTop: "96px", paddingLeft: "48px" });
});
