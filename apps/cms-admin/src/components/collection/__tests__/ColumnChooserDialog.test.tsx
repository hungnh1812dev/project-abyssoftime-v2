import { ColumnChooserDialog } from "../ColumnChooserDialog";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test-utils";
import type { ContentType } from "@/types/cms";

const contentType: ContentType = {
  documentId: "ct-1",
  name: "Blog Posts",
  slug: "blog-posts",
  kind: "collection",
  draftToPublish: true,
  fields: [
    { name: "title", type: "text" },
    { name: "slug", type: "text" },
    { name: "body", type: "richtext" },
    { name: "featured", type: "boolean" },
    { name: "banner", type: "component" },
  ],
  listFields: [],
  createdAt: "",
  updatedAt: "",
};

function renderDialog(props: Partial<React.ComponentProps<typeof ColumnChooserDialog>> = {}) {
  const defaults = {
    open: true,
    onOpenChange: vi.fn(),
    contentType,
    currentListFields: [] as string[],
    onSave: vi.fn(),
    isSaving: false,
    ...props,
  };
  return { ...renderWithProviders(<ColumnChooserDialog {...defaults} />), ...defaults };
}

describe("ColumnChooserDialog", () => {
  it("renders an accessible title and description, wired into aria-describedby", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Configure columns" })).toBeInTheDocument();
      expect(screen.getByText("Choose which columns to display in the list view.")).toBeInTheDocument();
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(1);
  });

  it("renders content fields excluding component types", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText("title")).toBeInTheDocument();
      expect(screen.getByText("slug")).toBeInTheDocument();
      expect(screen.getByText("body")).toBeInTheDocument();
      expect(screen.getByText("featured")).toBeInTheDocument();
      expect(screen.queryByText("banner")).not.toBeInTheDocument();
    });
  });

  it("renders system fields section", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText("ID")).toBeInTheDocument();
      expect(screen.getByText("Created At")).toBeInTheDocument();
      expect(screen.getByText("Updated At")).toBeInTheDocument();
      expect(screen.getByText("Updated By")).toBeInTheDocument();
    });
  });

  it("defaults to first 3 content fields + all system fields when currentListFields is empty", async () => {
    renderDialog({ currentListFields: [] });
    await waitFor(() => {
      const checkboxes = screen.getAllByRole("checkbox");
      const checkedNames: string[] = [];
      for (const checkbox of checkboxes) {
        if ((checkbox as HTMLInputElement).checked) {
          const label = checkbox.closest("label");
          if (label) checkedNames.push(label.textContent ?? "");
        }
      }
      expect(checkedNames).toContain("title");
      expect(checkedNames).toContain("slug");
      expect(checkedNames).toContain("body");
      expect(checkedNames).not.toContain("featured");
      expect(checkedNames).toContain("ID");
      expect(checkedNames).toContain("Created At");
      expect(checkedNames).toContain("Updated At");
      expect(checkedNames).toContain("Updated By");
    });
  });

  it("initializes from currentListFields when provided", async () => {
    renderDialog({ currentListFields: ["title", "createdAt"] });
    await waitFor(() => {
      const checkboxes = screen.getAllByRole("checkbox");
      const checkedNames: string[] = [];
      for (const checkbox of checkboxes) {
        if ((checkbox as HTMLInputElement).checked) {
          const label = checkbox.closest("label");
          if (label) checkedNames.push(label.textContent ?? "");
        }
      }
      expect(checkedNames).toEqual(["title", "Created At"]);
    });
  });

  it("calls onSave with selected fields in correct order", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({ currentListFields: ["title", "slug", "createdAt"] });

    await waitFor(() => screen.getByText("featured"));
    await user.click(screen.getByText("featured"));
    await user.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(["title", "slug", "featured", "createdAt"]);
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await waitFor(() => screen.getByText("Cancel"));
    await user.click(screen.getByText("Cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
