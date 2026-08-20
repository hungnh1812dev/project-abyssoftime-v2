import { DialogPanel } from "../dialog-panel";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("DialogPanel", () => {
  it("renders title, description, and children", () => {
    render(
      <DialogPanel open onOpenChange={() => {}} title="My Title" description="My description">
        <p>Body content</p>
      </DialogPanel>,
    );
    expect(screen.getByRole("heading", { name: "My Title" })).toBeInTheDocument();
    expect(screen.getByText("My description")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("wires aria-describedby to the description only when no note is passed", () => {
    render(
      <DialogPanel open onOpenChange={() => {}} title="Title" description="Description text">
        <p>Body</p>
      </DialogPanel>,
    );
    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    const ids = describedBy!.split(" ");
    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0])).toHaveTextContent("Description text");
  });

  it("renders the note and wires aria-describedby to both description and note when note is passed", () => {
    render(
      <DialogPanel open onOpenChange={() => {}} title="Title" description="Description text" note="Careful, this cannot be undone.">
        <p>Body</p>
      </DialogPanel>,
    );
    expect(screen.getByText("Careful, this cannot be undone.")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    const ids = dialog.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0])).toHaveTextContent("Description text");
    expect(document.getElementById(ids[1])).toHaveTextContent("Careful, this cannot be undone.");
  });

  it("omits the note block entirely when note is not passed", () => {
    render(
      <DialogPanel open onOpenChange={() => {}} title="Title" description="Description">
        <p>Body</p>
      </DialogPanel>,
    );
    expect(document.querySelector('[data-slot="dialog-note"]')).not.toBeInTheDocument();
  });
});
