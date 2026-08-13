import { test } from "@playwright/test";
import fs from "fs";

test("CV page spacing screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // /cv has requiresRole "all" in the CMS nav — public, no login needed.
  await page.goto("/en/cv");
  await page.waitForLoadState("networkidle");

  console.log("Current URL:", page.url());

  const outDir = "e2e/screenshots";
  fs.mkdirSync(outDir, { recursive: true });

  await page.screenshot({
    path: `${outDir}/cv-full.png`,
    fullPage: true,
  });
  console.log("Full page screenshot saved");

  await page.screenshot({
    path: `${outDir}/cv-viewport.png`,
    fullPage: false,
  });

  // Chụp từng section riêng
  const sectionSelectors = [
    "[class*='sectionSummary'], [class*='SectionSummary']",
    "[class*='sectionSkills'], [class*='SectionSkills']",
    "[class*='sectionExperience'], [class*='SectionExperience']",
    "[class*='sectionProjects'], [class*='SectionProjects']",
    "[class*='sectionEducation'], [class*='SectionEducation']",
    "[class*='sectionLanguages'], [class*='SectionLanguages']",
  ];

  for (let i = 0; i < sectionSelectors.length; i++) {
    const el = page.locator(sectionSelectors[i]).first();
    if ((await el.count()) > 0) {
      await el.screenshot({ path: `${outDir}/section-${i + 1}.png` });
      console.log(`Section ${i + 1} screenshot saved`);
    }
  }

  // Capture spacing info of top-level CV sections
  const spacingInfo = await page.evaluate(() => {
    const results: {
      id: string;
      className: string;
      marginTop: string;
      marginBottom: string;
      paddingTop: string;
      paddingBottom: string;
      gapY: string;
      height: string;
      top: number;
    }[] = [];

    // Query all direct children of CV container and section wrappers
    const els = document.querySelectorAll("[class*='cv'] > *, [class*='Cv'] > *, [class*='section'], [class*='Section']");
    els.forEach((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.height > 30) {
        results.push({
          id: el.id || "",
          className: el.className?.toString()?.slice(0, 120) || el.tagName,
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          gapY: style.rowGap,
          height: Math.round(rect.height) + "px",
          top: Math.round(rect.top),
        });
      }
    });
    // Deduplicate by top position
    const seen = new Set<number>();
    return results
      .filter((r) => {
        if (seen.has(r.top)) return false;
        seen.add(r.top);
        return true;
      })
      .slice(0, 30);
  });

  console.log("=== SPACING INFO ===");
  console.log(JSON.stringify(spacingInfo, null, 2));
});
