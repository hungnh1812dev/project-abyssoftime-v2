import { ConfirmDialog } from "../confirm-dialog";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("ConfirmDialog", () => {
  it("renders title, description, and the default Confirm label", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Delete item" description="Delete this item?" onConfirm={() => {}} />);
    expect(screen.getByRole("heading", { name: "Delete item" })).toBeInTheDocument();
    expect(screen.getByText("Delete this item?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("renders a custom confirmLabel", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Revoke" description="Revoke?" confirmLabel="Revoke" onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("renders the note and wires it into aria-describedby when passed", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Delete" description="Are you sure?" note="This cannot be undone." onConfirm={() => {}} />);
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    const ids = dialog.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(2);
  });

  it("omits the note when not passed", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Delete" description="Are you sure?" onConfirm={() => {}} />);
    expect(document.querySelector('[data-slot="dialog-note"]')).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(1);
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => {}} title="Delete" description="Are you sure?" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("closes via onOpenChange when Cancel is clicked", async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete" description="Are you sure?" onConfirm={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("shows a loading confirm button when loading is true", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Delete" description="Are you sure?" loading onConfirm={() => {}} />);
    const buttons = screen.getAllByRole("button").filter((button) => button.tagName === "BUTTON");
    const confirmButton = buttons.find((button) => button.textContent !== "Cancel");
    expect(confirmButton).toHaveAttribute("aria-busy", "true");
  });

  it("does not render the built-in dialog close (X) button", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Delete" description="Are you sure?" onConfirm={() => {}} />);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
