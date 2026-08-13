import { expect, test } from "@playwright/test";
import { loginAs } from "./test-helpers";

test.describe("EN Vocab — pack trigger shows topic description", () => {
  test("closed PackPicker trigger shows the pack's topic text and a title tooltip", async ({ page }) => {
    await loginAs(page, "admin", "/en/learning/english?group=1&pack=1");

    const trigger = page.getByRole("button", { name: /^Pack 1\b/ }).first();

    await expect(trigger).toContainText("Chào hỏi & Từ cơ bản nhất");
    await expect(trigger).toHaveAttribute("title", /Chào hỏi & Từ cơ bản nhất/);
  });
});
