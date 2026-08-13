import { expect, test } from "@playwright/test";
import { loginAs } from "./test-helpers";

test.describe("EN Vocab — Reset Progress", () => {
  test("cancel leaves progress untouched, confirm clears all learned words", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/english?group=1&pack=1");

    await page.locator('input[type="checkbox"]').first().check();
    await expect(page.getByText("1/10 learned")).toBeVisible();

    await page.getByRole("button", { name: "Reset Progress" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByText("1/10 learned")).toBeVisible();

    await page.getByRole("button", { name: "Reset Progress" }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByText("0/10 learned")).toBeVisible();
    await expect(page.locator('input[type="checkbox"]').first()).not.toBeChecked();
  });

  test("game page shows the empty state after progress is reset", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/english?group=1&pack=1");

    await page.locator('input[type="checkbox"]').first().check();
    await expect(page.getByText("1/10 learned")).toBeVisible();

    await page.getByRole("button", { name: "Reset Progress" }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByText("0/10 learned")).toBeVisible();

    await page.goto("/en/learning/english/game");
    await expect(page.getByText(/no learned words yet/i)).toBeVisible();
  });
});
