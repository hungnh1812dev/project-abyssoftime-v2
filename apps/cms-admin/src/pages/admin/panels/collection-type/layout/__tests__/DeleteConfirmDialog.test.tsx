import { DeleteConfirmDialog } from "../DeleteConfirmDialog";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("DeleteConfirmDialog", () => {
  it("renders single-entry copy when bulkCount is null", () => {
    render(<DeleteConfirmDialog open bulkCount={null} onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("heading", { name: "Delete entry" })).toBeInTheDocument();
    expect(screen.getByText("Are you sure you want to delete this entry?")).toBeInTheDocument();
  });

  it("renders bulk copy with the count when bulkCount is set", () => {
    render(<DeleteConfirmDialog open bulkCount={3} onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("heading", { name: "Delete 3 entries" })).toBeInTheDocument();
    expect(screen.getByText("Are you sure you want to delete 3 selected entries?")).toBeInTheDocument();
  });

  it("always shows the cannot-be-undone note, wired into aria-describedby", () => {
    render(<DeleteConfirmDialog open bulkCount={null} onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });

  it("calls onConfirm when Delete is clicked", async () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog open bulkCount={null} onOpenChange={() => {}} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("closes via onOpenChange when Cancel is clicked", async () => {
    const onOpenChange = vi.fn();
    render(<DeleteConfirmDialog open bulkCount={null} onOpenChange={onOpenChange} onConfirm={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("does not render the built-in dialog close (X) button", () => {
    render(<DeleteConfirmDialog open bulkCount={null} onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
