import { expect, test } from "@playwright/test";

import { loginAs } from "./test-helpers";

// Header nav is CMS-driven and filtered server-side per role (SPEC.md success criteria 2-4).
// Assertions are scoped to the `header` element — Radix portals dropdown/mobile-menu content
// outside it, so this can't accidentally match hidden nav copies.

test.describe("Nav — role-based visibility", () => {
  test("anonymous sees the Login link and only public nav", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/en");

    const header = page.locator("header");
    await expect(header.locator('a[href^="/auth"]')).toBeVisible();
    await expect(header.getByRole("link", { name: "CV", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Vaccine", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Secret", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Account", exact: true })).toHaveCount(0);
  });

  test("admin sees admin-gated links but not super_admin-only links", async ({ page }) => {
    await loginAs(page, "admin", "/en");

    const header = page.locator("header");
    await expect(header.locator('a[href^="/auth"]')).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Vaccine", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Secret", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Account", exact: true })).toHaveCount(0);
  });

  test("super_admin sees Secret and Account in addition to admin-gated links", async ({ page }) => {
    await loginAs(page, "super_admin", "/en");

    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "Vaccine", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Secret", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Account", exact: true })).toBeVisible();
  });
});
