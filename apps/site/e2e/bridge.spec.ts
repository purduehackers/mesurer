import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { run } from "../../../packages/mesurer/bridge/cli";

// The dev server's comments bridge, end to end: a comment made in the browser lands in
// .mesurer/comments.json, and an agent's reply and resolution through the CLI show up live.

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const file = path.join(root, ".mesurer/comments.json");

const cli = async (...args: string[]) => {
  const code = await run([...args, "--root", root]);
  expect(code).toBe(0);
};

const readThreads = async () => {
  try {
    return JSON.parse(await readFile(file, "utf8")).threads as Array<Record<string, any>>;
  } catch {
    return [];
  }
};

const activateComments = async (page: Page) => {
  const annotate = page.getByRole("button", { name: "Annotate tools (2)" });
  if (await annotate.isVisible()) await annotate.click();
  await page.getByRole("button", { name: "Comments (M)" }).click();
};

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await rm(file, { force: true });
});

test("a comment goes to the project file and the agent's answer comes back live", async ({ page }) => {
  await page.goto("/e2e/fixtures/bridge.html");
  await activateComments(page);
  const heading = await page.getByRole("heading", { name: "Merch drop" }).boundingBox();
  if (!heading) throw new Error("heading not visible");
  await page.mouse.click(heading.x + 60, heading.y + heading.height / 2);
  await page.getByRole("textbox", { name: "Comment" }).fill("Make the title bigger");
  await page.getByRole("button", { name: "Send comment" }).click();

  await expect.poll(async () => (await readThreads()).length, { timeout: 5000 }).toBe(1);
  const [saved] = await readThreads();
  expect(saved.page).toBe("/e2e/fixtures/bridge.html");
  expect(saved.target.source).toEqual({ file: "src/pages/index.astro", line: 12, column: 5 });
  expect(saved.messages[0].text).toBe("Make the title bigger");

  await page.locator("[data-mesurer-comment-pin]").click();
  const card = page.locator("[data-mesurer-comment-popover]");
  await expect(card).toContainText("Make the title bigger");

  await cli("comments", "reply", saved.id, "Bumping it to 40px.");
  await expect(card).toContainText("Agent");
  await expect(card).toContainText("Bumping it to 40px.");

  await cli("comments", "resolve", saved.id, "Set h1 to text-4xl in index.astro");
  await expect.poll(async () => (await readThreads())[0]?.status).toBe("resolved");
  await expect(page.locator("[data-mesurer-comment-resolution]")).toContainText(
    "Resolved by agent · Set h1 to text-4xl in index.astro",
  );

  // Reloading keeps it: the page reads the file again.
  await page.reload();
  await expect.poll(async () => (await readThreads())[0]?.resolution).toBe("Set h1 to text-4xl in index.astro");
});

test("deleting a comment in the browser removes it from the file", async ({ page }) => {
  await page.goto("/e2e/fixtures/bridge.html");
  await activateComments(page);
  const heading = await page.getByRole("heading", { name: "Merch drop" }).boundingBox();
  if (!heading) throw new Error("heading not visible");
  await page.mouse.click(heading.x + 60, heading.y + heading.height / 2);
  await page.getByRole("textbox", { name: "Comment" }).fill("Temporary");
  await page.getByRole("button", { name: "Send comment" }).click();
  await expect.poll(async () => (await readThreads()).length, { timeout: 5000 }).toBe(1);

  await page.locator("[data-mesurer-comment-pin]").click();
  const card = page.locator("[data-mesurer-comment-popover]");
  await card.getByRole("button", { name: "Comment actions" }).first().click();
  await page.locator("[data-mesurer-comment-overflow-menu]").getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect.poll(async () => (await readThreads()).length, { timeout: 5000 }).toBe(0);
});
