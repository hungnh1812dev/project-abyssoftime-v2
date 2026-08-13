import { expect, test } from "@playwright/test";

import { loginAs } from "./test-helpers";

test.describe("Auth — login and logout", () => {
  test("returnTo redirect: anonymous hitting a protected page lands there after login", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/en/secret");
    await expect(page).toHaveURL(/\/en\/auth\?returnTo=%2Fen%2Fsecret/);

    await loginAs(page, "super_admin", "/en/secret");
    await expect(page).toHaveURL(/\/en\/secret$/);
  });

  test("logout restores anonymous state without a hard reload", async ({ page }) => {
    await loginAs(page, "admin", "/en/vaccine");

    const header = page.locator("header");
    const loginLink = header.locator('a[href^="/auth"]');
    await expect(loginLink).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Vaccine", exact: true })).toBeVisible();

    // The hamburger (mobile-menu) button is always in the header — target the other one.
    await header.locator('button:not([aria-label="Open menu"])').click();
    await page.getByRole("menuitem").click();

    await expect(loginLink).toBeVisible();
    await expect(header.getByRole("link", { name: "Vaccine", exact: true })).toHaveCount(0);

    await page.goto("/en/vaccine");
    await expect(page).toHaveURL(/\/en\/auth\?returnTo=%2Fen%2Fvaccine/);
  });
});
