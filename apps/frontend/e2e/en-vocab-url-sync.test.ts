import { expect, test } from "@playwright/test";
import { loginAs } from "./test-helpers";

test.describe("EN Vocab — URL-synced pack navigation", () => {
  test("direct URL load renders the requested group/pack", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/english?group=2&pack=3");

    await expect(page.getByRole("button", { name: /^Pack 13\b/ }).first()).toBeVisible();
  });

  test("selecting a different pack replaces the URL instead of pushing a new history entry", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/english?group=1&pack=1");

    await page.goto("/en/learning/english?group=1&pack=2");
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("button", { name: /^Pack 2\b/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^\d+ Pack 5\b/ })
      .first()
      .click();
    await page.waitForURL(/pack=5/);

    await page.goBack();
    await expect(page).toHaveURL(/group=1&pack=1(?!\d)/);
  });

  test("out-of-range group/pack in the URL clamps to a valid pack", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/english?group=999&pack=1");

    await expect(page).not.toHaveURL(/group=999/);
  });
});
