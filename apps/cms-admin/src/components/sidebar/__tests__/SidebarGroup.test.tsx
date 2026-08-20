import { SidebarContext } from "../SidebarContext";
import { SidebarGroup } from "../SidebarGroup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home } from "lucide-react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

const collapsedContextValue = {
  collapsed: true,
  toggle: () => {},
  isMobile: false,
  mobileOpen: false,
  setMobileOpen: () => {},
};

function Harness() {
  const navigate = useNavigate();
  return (
    <SidebarContext.Provider value={collapsedContextValue}>
      <button type="button" onClick={() => navigate("/admin/other")}>
        Navigate away
      </button>
      <SidebarGroup icon={Home} label="Content" storageKey="content">
        <div>Group item</div>
      </SidebarGroup>
    </SidebarContext.Provider>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("SidebarGroup — collapsed flyout closes on navigation", () => {
  it("closes the open flyout once the route changes", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "Content" }));
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Navigate away" }));

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("does not close the flyout on a re-render at the same route", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "Content" }));
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());

    // Re-render without a pathname change (e.g. a parent state update) must not
    // reset flyoutOpen — only an actual pathname change should.
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
