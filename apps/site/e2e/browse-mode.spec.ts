import { expect, test, type Page } from "@playwright/test";

// Minimizing from the toolbar (or with `) leaves the page free to use, with the comment pins
// still on it.

const addComment = async (page: Page, text: string) => {
  const annotate = page.getByRole("button", { name: "Annotate tools (2)" });
  if (await annotate.isVisible()) await annotate.click();
  await page.getByRole("button", { name: "Comments (M)" }).click();
  const heading = await page.getByRole("heading", { name: "Merch drop" }).boundingBox();
  if (!heading) throw new Error("heading not visible");
  await page.mouse.click(heading.x + 60, heading.y + heading.height / 2);
  await page.getByRole("textbox", { name: "Comment" }).fill(text);
  await page.getByRole("button", { name: "Send comment" }).click();
  await expect(page.locator("[data-mesurer-comment-pin]")).toHaveCount(1);
};

test.beforeEach(async ({ page }) => {
  // The bridge fixture keeps comments in a file; start each test without any.
  await page.route("**/__mesurer/comments**", (route) => route.fulfill({ status: 404 }));
});

test("the toolbar's minimize button frees the page and keeps comment pins", async ({ page }) => {
  await page.goto("/e2e/fixtures/bridge.html");
  await addComment(page, "Check spacing");

  await page.getByRole("button", { name: "Minimize (`)" }).click();
  await expect(page.getByRole("button", { name: "Show Mesurer toolbar" })).toBeVisible();

  const pageButton = page.getByTestId("page-button");
  await pageButton.click();
  await expect(pageButton).toHaveText("Clicked");

  const pin = page.locator("[data-mesurer-comment-pin]");
  await expect(pin).toBeVisible();
  await pin.hover();
  await expect(page.locator("[data-mesurer-comment-hover-card]")).toContainText("Check spacing");

  await page.getByRole("button", { name: "Show Mesurer toolbar" }).click();
  await expect(page.getByRole("button", { name: /^Settings \(/ })).toBeVisible();
});

test("` minimizes and restores the toolbar", async ({ page }) => {
  await page.goto("/e2e/fixtures/bridge.html");
  await expect(page.getByRole("button", { name: /^Settings \(/ })).toBeVisible();
  await page.keyboard.press("`");
  await expect(page.getByRole("button", { name: "Show Mesurer toolbar" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Settings \(/ })).toBeHidden();
  await page.keyboard.press("`");
  await expect(page.getByRole("button", { name: /^Settings \(/ })).toBeVisible();
});

test("comment pins can be hidden while minimized", async ({ page }) => {
  await page.goto("/e2e/fixtures/bridge.html");
  await addComment(page, "Hide me");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Settings \(/ }).click();
  await page.getByRole("switch", { name: "Comments when minimized" }).click();
  await page.getByRole("button", { name: /^Settings \(/ }).click();
  await page.getByRole("button", { name: "Minimize (`)" }).click();
  await expect(page.locator("[data-mesurer-comment-pin]")).toHaveCount(0);
  await page.keyboard.press("`");
  await expect(page.locator("[data-mesurer-comment-pin]")).toHaveCount(1);
});
