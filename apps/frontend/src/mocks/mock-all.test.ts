import { describe, expect, test } from "bun:test";

import { CVNewList_MockData } from "./cv-new-list";
import { MockView } from "./mock-all";

describe("cv-new per-document mocks", () => {
  test("every entry in the cv-new list mock has a matching cv-new-<documentId> mock registered", () => {
    for (const { documentId } of CVNewList_MockData) {
      const key = `cv-new-${documentId}`;
      expect(MockView[key]).toBeDefined();
    }
  });
});
