import { Page } from "@playwright/test";

// Real per-role accounts, credentials in `.env.local` (see tasks/plan.md Correction 17 for how
// they were provisioned). The passcode gate is gone (T14) — every protected page now requires a
// real login through Auth.js's Credentials form.
export type TestRole = "guest" | "editor" | "admin" | "super_admin";

function credentialsFor(role: TestRole): { email: string; password: string } {
  const envPrefix = `E2E_${role.toUpperCase()}`;
  const email = process.env[`${envPrefix}_EMAIL`];
  const password = process.env[`${envPrefix}_PASSWORD`];

  if (!email || !password) {
    throw new Error(`Missing ${envPrefix}_EMAIL / ${envPrefix}_PASSWORD in .env.local — required to log in as "${role}" for E2E tests.`);
  }

  return { email, password };
}

export async function loginAs(page: Page, role: TestRole, targetPath: string) {
  const { email, password } = credentialsFor(role);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/auth?returnTo=${encodeURIComponent(targetPath)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(new RegExp(targetPath.split("?")[0].replace(/\//g, "\\/")));
  await page.waitForLoadState("networkidle");
}
