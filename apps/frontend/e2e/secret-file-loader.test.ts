import { test, expect } from "@playwright/test";

import { loginAs } from "./test-helpers";

test("Load Content button: disabled by default, enabled when filePassword has value", async ({ page }) => {
  // /secret requires super_admin (T1 audited it into the CMS nav) — it was never gated pre-T14.
  await loginAs(page, "super_admin", "/en/secret");

  const loadBtn = page.getByRole("button", { name: "Load Content" });

  // Initially disabled
  await expect(loadBtn).toBeDisabled();

  // Type into File Password field
  const filePasswordInput = page.locator('input[id="text-input-filePassword"]');
  await filePasswordInput.fill("mypassword");

  // Should now be enabled
  await expect(loadBtn).toBeEnabled();

  // Clear the password
  await filePasswordInput.fill("");

  // Should be disabled again
  await expect(loadBtn).toBeDisabled();
});
