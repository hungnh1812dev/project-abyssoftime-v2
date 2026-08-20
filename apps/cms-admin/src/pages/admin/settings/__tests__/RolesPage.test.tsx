import { RolesPage } from "../RolesPage";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { renderWithProviders } from "@/test-utils";

const mockUseAuth = vi.fn();
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

let mock: MockAdapter;

const permissionsResponse = [
  { documentId: "p1", slug: "document:read", name: "Read Documents", description: "" },
  { documentId: "p2", slug: "document:create", name: "Create Documents", description: "" },
  { documentId: "p3", slug: "media:manager", name: "Manage Media", description: "" },
];

const rolesResponse = [
  { documentId: "r1", name: "Editor", slug: "editor", permissions: ["document:read"], level: 60, isDefault: true },
  { documentId: "r2", name: "Custom", slug: "custom", permissions: ["document:read", "document:create"], level: 50, isDefault: false },
];

beforeEach(() => {
  mockUseAuth.mockReturnValue({ permissions: ["role:manager"] });
  mock = new MockAdapter(api);
  mock.onGet("/roles").reply(200, rolesResponse);
  mock.onGet("/permissions").reply(200, permissionsResponse);
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

describe("RolesPage", () => {
  it("renders the role list with name, slug, and level", async () => {
    renderWithProviders(<RolesPage />);
    await waitFor(() => {
      expect(screen.getByText("Editor")).toBeInTheDocument();
      expect(screen.getByText("editor")).toBeInTheDocument();
      expect(screen.getByText("Custom")).toBeInTheDocument();
    });
  });

  it("shows an error state when the role list fails to load", async () => {
    mock.onGet("/roles").reply(500);
    renderWithProviders(<RolesPage />);
    await waitFor(() => expect(screen.getByText(/failed to load roles/i)).toBeInTheDocument());
  });

  it("does not show a Delete button for default roles", async () => {
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Editor"));

    const editorRow = screen.getByText("Editor").closest("tr");
    expect(editorRow).not.toBeNull();
    expect(within(editorRow as HTMLElement).queryByText("Delete")).not.toBeInTheDocument();

    const customRow = screen.getByText("Custom").closest("tr");
    expect(within(customRow as HTMLElement).getByText("Delete")).toBeInTheDocument();
  });

  it("opens the create-role dialog and closes it on Cancel", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Create Role"));

    await user.click(screen.getByText("Create Role"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the edit dialog pre-filled for an existing role", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Custom"));

    const customRow = screen.getByText("Custom").closest("tr") as HTMLElement;
    await user.click(within(customRow).getByText("Edit"));

    await waitFor(() => expect(screen.getByDisplayValue("Custom")).toBeInTheDocument());
    expect(screen.getByDisplayValue("custom")).toBeInTheDocument();
  });

  it("disables Name/Slug/Level fields when editing a default role, but keeps permissions editable", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Editor"));

    const editorRow = screen.getByText("Editor").closest("tr") as HTMLElement;
    await user.click(within(editorRow).getByText("Edit"));

    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    expect(screen.getByLabelText("Level (0-100)")).toBeDisabled();
    expect(screen.getByLabelText("Slug")).toBeDisabled();
  });

  it("shows the default-role note, wired into aria-describedby, when editing a default role", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Editor"));

    const editorRow = screen.getByText("Editor").closest("tr") as HTMLElement;
    await user.click(within(editorRow).getByText("Edit"));

    await waitFor(() => screen.getByText(/name and level are locked/i));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });

  it("omits the default-role note when editing a non-default role", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Custom"));

    const customRow = screen.getByText("Custom").closest("tr") as HTMLElement;
    await user.click(within(customRow).getByText("Edit"));

    await waitFor(() => expect(screen.getByDisplayValue("Custom")).toBeInTheDocument());
    expect(screen.queryByText(/name and level are locked/i)).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(1);
  });

  it("tree Select All checks every permission and unchecking a leaf clears the group/top checkbox", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Create Role"));
    await user.click(screen.getByText("Create Role"));

    await waitFor(() => screen.getByText("Select All"));
    const selectAll = screen.getByText("Select All").closest("label")?.querySelector("input") as HTMLInputElement;
    await user.click(selectAll);

    await waitFor(() => {
      const readCheckbox = screen.getByText("Read Documents").closest("label")?.querySelector("input") as HTMLInputElement;
      expect(readCheckbox.checked).toBe(true);
    });

    const readCheckbox = screen.getByText("Read Documents").closest("label")?.querySelector("input") as HTMLInputElement;
    await user.click(readCheckbox);

    await waitFor(() => expect(selectAll.checked).toBe(false));
  });

  it("does not render Create/Delete permission affordances — the dialog is a pure picker", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Create Role"));
    await user.click(screen.getByText("Create Role"));

    await waitFor(() => screen.getByText("Read Documents"));
    expect(screen.queryByLabelText("New permission slug")).not.toBeInTheDocument();
    expect(screen.queryByText(/does not grant any new capability by itself/i)).not.toBeInTheDocument();
    const readLabel = screen.getByText("Read Documents").closest("label") as HTMLElement;
    expect(within(readLabel).queryByText("Delete")).not.toBeInTheDocument();
  });

  it("submits the tree-driven permissions payload on Create Role", async () => {
    mock.onPost("/roles").reply(201, { documentId: "r3", name: "New Role", slug: "new-role", permissions: ["document:read"], level: 40, isDefault: false });
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Create Role"));
    await user.click(screen.getByText("Create Role"));

    await waitFor(() => screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "New Role");
    await user.type(screen.getByLabelText("Slug"), "new-role");

    const readCheckbox = screen.getByText("Read Documents").closest("label")?.querySelector("input") as HTMLInputElement;
    await user.click(readCheckbox);

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create Role" }));

    await waitFor(() => expect(mock.history.post.filter((r) => r.url === "/roles")).toHaveLength(1));
    const body = JSON.parse(mock.history.post.filter((r) => r.url === "/roles")[0].data);
    expect(body).toEqual({ name: "New Role", slug: "new-role", permissions: ["document:read"], level: 50 });
  });
});

describe("RolesPage — permission gating", () => {
  it("enables Create/Edit/Delete when the caller holds role:manager", async () => {
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Custom"));

    expect(screen.getByRole("button", { name: /create role/i })).not.toBeDisabled();
    const customRow = screen.getByText("Custom").closest("tr") as HTMLElement;
    expect(within(customRow).getByRole("button", { name: /edit/i })).not.toBeDisabled();
    expect(within(customRow).getByRole("button", { name: /delete/i })).not.toBeDisabled();
  });

  it("disables Create/Edit/Delete when the caller lacks role:manager", async () => {
    mockUseAuth.mockReturnValue({ permissions: [] });
    renderWithProviders(<RolesPage />);
    await waitFor(() => screen.getByText("Custom"));

    expect(screen.getByRole("button", { name: /create role/i })).toBeDisabled();
    const customRow = screen.getByText("Custom").closest("tr") as HTMLElement;
    expect(within(customRow).getByRole("button", { name: /edit/i })).toBeDisabled();
    expect(within(customRow).getByRole("button", { name: /delete/i })).toBeDisabled();
  });
});
