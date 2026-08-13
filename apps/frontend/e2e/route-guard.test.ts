import { expect, test } from "@playwright/test";

import { loginAs } from "./test-helpers";

// Enforcement lives in proxy.ts (SPEC.md "Always: Enforce access in proxy.ts and/or requireRole()")
// — these assert the redirect itself, independent of what the header nav happens to show.

test.describe("Route guard — direct URL access", () => {
  test("anonymous hitting a super_admin page directly is redirected with returnTo", async ({ page }) => {
    await page.goto("/en/secret");
    await expect(page).toHaveURL(/\/en\/auth\?returnTo=%2Fen%2Fsecret/);
  });

  test("admin hitting a super_admin-only page directly is redirected, not rendered", async ({ page }) => {
    await loginAs(page, "admin", "/en");

    await page.goto("/en/secret");
    await expect(page).toHaveURL(/\/en\/auth\?returnTo=%2Fen%2Fsecret/);
    await expect(page.getByRole("button", { name: "Load Content" })).toHaveCount(0);
  });
});
