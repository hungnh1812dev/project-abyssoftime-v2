import { expect, test } from "@playwright/test";
import fs from "fs";

// /cv-3 has requiresRole "all" in the CMS nav — public, no login needed (same as /cv, see cv-spacing.test.ts).

test.describe("CV New — /cv-3 layout", () => {
  test("renders the seven sections in order, no standalone Projects section, empty-projects role has no project card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/en/cv-3");
    await page.waitForLoadState("networkidle");

    const outDir = "e2e/screenshots";
    fs.mkdirSync(outDir, { recursive: true });

    await page.screenshot({ path: `${outDir}/cv-3-full.png`, fullPage: true });

    const sectionIds = ["about-me", "experience", "skills", "education", "languages", "references"];
    for (const id of sectionIds) {
      const el = page.locator(`#${id}`);
      if ((await el.count()) > 0) {
        await el.first().screenshot({ path: `${outDir}/cv-3-${id}.png` });
      }
    }

    // Section order: the CV's own header (the one carrying the h1 name), then the six body sections —
    // the site-wide nav bar is also a <header>, so scope to the one with an h1.
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll("header:has(h1), section[id]")).map((el) => (el.tagName === "HEADER" ? "header" : el.id)),
    );
    expect(order).toEqual(["header", "about-me", "experience", "skills", "education", "languages", "references"]);

    // No standalone Projects section — projects nest under each role instead.
    await expect(page.locator("#projects")).toHaveCount(0);

    // The mock's second Gameloft role ("Frontend Developer") has an empty projects array;
    // it should still render, just without any project card (h5) inside it.
    const emptyProjectsRole = page.locator("xpath=//p[normalize-space(text())='Frontend Developer']/parent::div");
    await expect(emptyProjectsRole).toHaveCount(1);
    await expect(emptyProjectsRole.locator("h5")).toHaveCount(0);
  });
});
