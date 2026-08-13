import { expect, test } from "@playwright/test";
import { loginAs } from "./test-helpers";

test.describe("Go Knowledge Base", () => {
  test("page loads and shows the default section", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/develop/go");

    await expect(page.getByRole("heading", { name: "Syntax & Basics" })).toBeVisible();
  });

  test("sidebar section click switches visible content", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/develop/go");

    // Desktop sidebar link comes first in the DOM, before the mobile chip strip
    await page
      .getByRole("link", { name: /Concurrency/ })
      .first()
      .click();
    await page.waitForURL(/section=concurrency/);

    await expect(page.getByRole("heading", { name: "Concurrency" })).toBeVisible();
  });

  test("mobile chip click switches content", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/develop/go");
    await page.setViewportSize({ width: 390, height: 844 });

    // The mobile chip renders after the (now hidden) desktop sidebar link in the DOM
    await page
      .getByRole("link", { name: /Security/ })
      .last()
      .click();
    await page.waitForURL(/section=security/);

    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  });

  test("search filters results within the active section", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/develop/go?section=concurrency");

    await page.getByPlaceholder("Search topics, concepts...").fill("mutex");
    await page.waitForURL(/q=mutex/);
    await expect(page.getByText("sync.Mutex & sync.RWMutex")).toBeVisible();

    await page.getByPlaceholder("Search topics, concepts...").fill("grpc");
    await page.waitForURL(/q=grpc/);
    await expect(page.getByText("No results found")).toBeVisible();
  });

  test("a topic card expands via click", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/develop/go");

    const firstCard = page.locator("details").first();
    await expect(firstCard).not.toHaveAttribute("open", "");

    await firstCard.locator("summary").click();
    await expect(firstCard).toHaveAttribute("open", "");
  });
});
