import * as DialogModule from "../dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../dialog";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("dialog.tsx (vanilla primitive)", () => {
  it("exports exactly the vanilla shadcn Dialog parts — no app-specific additions", () => {
    expect(Object.keys(DialogModule).sort()).toEqual(
      ["Dialog", "DialogClose", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogOverlay", "DialogPortal", "DialogTitle", "DialogTrigger"].sort(),
    );
  });

  it("composes into a working dialog with title, description, and footer", () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Plain Dialog</DialogTitle>
            <DialogDescription>A description.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button">OK</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("heading", { name: "Plain Dialog" })).toBeInTheDocument();
    expect(screen.getByText("A description.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });
});
