import { PermissionsPage } from "../PermissionsPage";
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
  { documentId: "p1", slug: "document:read", name: "Read Documents", description: "View documents" },
  { documentId: "p2", slug: "media:manager", name: "Manage Media", description: "Upload, delete, and edit media" },
];

beforeEach(() => {
  mockUseAuth.mockReturnValue({ permissions: ["permission:manager"] });
  mock = new MockAdapter(api);
  mock.onGet("/permissions").reply(200, permissionsResponse);
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

describe("PermissionsPage — DataTable styling", () => {
  it("gives the header row a dark sky-blue background", async () => {
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => expect(screen.getByText("document:read")).toBeInTheDocument());
    const headerRow = screen.getByText("Slug", { selector: "th" }).closest("tr")!;
    expect(headerRow.className.split(/\s+/)).toContain("bg-sky-700");
  });
});

describe("PermissionsPage", () => {
  it("renders the permission catalog with slug, name, and description", async () => {
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => {
      expect(screen.getByText("document:read")).toBeInTheDocument();
      expect(screen.getByText("Read Documents")).toBeInTheDocument();
      expect(screen.getByText("View documents")).toBeInTheDocument();
      expect(screen.getByText("media:manager")).toBeInTheDocument();
    });
  });

  it("shows an error state when the catalog fails to load", async () => {
    mock.onGet("/permissions").reply(500);
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => expect(screen.getByText(/failed to load permissions/i)).toBeInTheDocument());
  });

  it("opens the create-permission dialog and closes it on Cancel", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("Create Permission"));

    await user.click(screen.getByText("Create Permission"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("rejects a malformed slug and keeps the submit button disabled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("Create Permission"));
    await user.click(screen.getByText("Create Permission"));

    await waitFor(() => screen.getByLabelText("Slug"));
    await user.type(screen.getByLabelText("Slug"), "NoColon");
    await user.type(screen.getByLabelText("Name"), "Bad");

    expect(screen.getByText(/must match resource:action format/i)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Create Permission" })).toBeDisabled();
  });

  it("submits a new permission on Create", async () => {
    mock.onPost("/permissions").reply(201, { documentId: "p3", slug: "reports:generate", name: "Generate Reports", description: "" });
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("Create Permission"));
    await user.click(screen.getByText("Create Permission"));

    await waitFor(() => screen.getByLabelText("Slug"));
    await user.type(screen.getByLabelText("Slug"), "reports:generate");
    await user.type(screen.getByLabelText("Name"), "Generate Reports");

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create Permission" }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ slug: "reports:generate", name: "Generate Reports", description: "" });
  });

  it("shows the create-only disclaimer note, wired into aria-describedby, when creating", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("Create Permission"));
    await user.click(screen.getByText("Create Permission"));

    await waitFor(() => screen.getByText(/does not grant any new capability by itself/i));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });

  it("omits the create-only disclaimer note when editing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("document:read"));

    const row = screen.getByText("document:read").closest("tr") as HTMLElement;
    await user.click(within(row).getByText("Edit"));

    await waitFor(() => expect(screen.getByDisplayValue("document:read")).toBeInTheDocument());
    expect(screen.queryByText(/does not grant any new capability by itself/i)).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(1);
  });

  it("opens the edit dialog pre-filled with the slug locked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("document:read"));

    const row = screen.getByText("document:read").closest("tr") as HTMLElement;
    await user.click(within(row).getByText("Edit"));

    await waitFor(() => expect(screen.getByDisplayValue("document:read")).toBeInTheDocument());
    expect(screen.getByDisplayValue("document:read")).toBeDisabled();
    expect(screen.getByDisplayValue("Read Documents")).toBeInTheDocument();
  });

  it("submits a name/description change on Save, not the slug", async () => {
    mock.onPut("/permissions/p1").reply(200, { documentId: "p1", slug: "document:read", name: "Read Docs (renamed)", description: "View documents" });
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("document:read"));

    const row = screen.getByText("document:read").closest("tr") as HTMLElement;
    await user.click(within(row).getByText("Edit"));

    await waitFor(() => screen.getByDisplayValue("Read Documents"));
    await user.clear(screen.getByDisplayValue("Read Documents"));
    await user.type(screen.getByLabelText("Name"), "Read Docs (renamed)");

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mock.history.put).toHaveLength(1));
    expect(JSON.parse(mock.history.put[0].data)).toEqual({ name: "Read Docs (renamed)", description: "View documents" });
  });

  it("shows an inline error with role/token counts when deleting a referenced permission is blocked (409)", async () => {
    mock.onDelete("/permissions/p1").reply(409, { message: "Permission is still referenced", roleCount: 2, accessTokenCount: 0 });
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("document:read"));

    const row = screen.getByText("document:read").closest("tr") as HTMLElement;
    await user.click(within(row).getByText("Delete"));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByText(/2 role\(s\) and 0 access token\(s\)/i)).toBeInTheDocument());
  });

  it("deletes an unreferenced permission without error", async () => {
    mock.onDelete("/permissions/p2").reply(204);
    const user = userEvent.setup();
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("media:manager"));

    const row = screen.getByText("media:manager").closest("tr") as HTMLElement;
    await user.click(within(row).getByText("Delete"));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mock.history.delete).toHaveLength(1));
  });
});

describe("PermissionsPage — permission gating", () => {
  it("enables Create/Edit/Delete when the caller holds permission:manager", async () => {
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("document:read"));

    expect(screen.getByRole("button", { name: /create permission/i })).not.toBeDisabled();
    const row = screen.getByText("document:read").closest("tr") as HTMLElement;
    expect(within(row).getByRole("button", { name: /edit/i })).not.toBeDisabled();
    expect(within(row).getByRole("button", { name: /delete/i })).not.toBeDisabled();
  });

  it("disables Create/Edit/Delete when the caller lacks permission:manager", async () => {
    mockUseAuth.mockReturnValue({ permissions: [] });
    renderWithProviders(<PermissionsPage />);
    await waitFor(() => screen.getByText("document:read"));

    expect(screen.getByRole("button", { name: /create permission/i })).toBeDisabled();
    const row = screen.getByText("document:read").closest("tr") as HTMLElement;
    expect(within(row).getByRole("button", { name: /edit/i })).toBeDisabled();
    expect(within(row).getByRole("button", { name: /delete/i })).toBeDisabled();
  });
});
