import { UsersPage } from "../UsersPage";
import { screen, waitFor } from "@testing-library/react";
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

const superAdminRole = { documentId: "r1", name: "Super Admin", slug: "super_admin", permissions: [], level: 100, isDefault: true };
const editorRole = { documentId: "r2", name: "Editor", slug: "editor", permissions: [], level: 60, isDefault: true };
const guestRole = { documentId: "r3", name: "Guest", slug: "guest", permissions: [], level: 0, isDefault: true };
const rolesResponse = [superAdminRole, editorRole, guestRole];

const usersResponse = [
  { documentId: "u1", email: "alice@example.com", name: "Alice Admin", username: "alice", accountType: true, verified: true, roleId: "r1", createdAt: "", updatedAt: "" },
  { documentId: "u2", email: "bob@example.com", name: "Bob Editor", username: "bob", accountType: true, verified: true, roleId: "r2", createdAt: "", updatedAt: "" },
];

beforeEach(() => {
  mockUseAuth.mockReturnValue({
    role: superAdminRole,
    permissions: ["user:manager", "user:role_manager"],
    userId: "u1",
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
  mock = new MockAdapter(api);
  mock.onGet("/users").reply(200, usersResponse);
  mock.onGet("/roles").reply(200, rolesResponse);
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

describe("UsersPage — DataTable styling", () => {
  it("gives the header row a bg-muted background", async () => {
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Display Name")).toBeInTheDocument());
    const headerRow = screen.getByText("Display Name").closest("tr")!;
    // Exact-token check: the base TableRow classes already contain "bg-muted" as a
    // substring (inside "data-[state=selected]:bg-muted"), so a plain .toContain would
    // false-positive even without DataTable's header styling applied.
    expect(headerRow.className.split(/\s+/)).toContain("bg-muted");
  });

  it("keeps the bg-accent/30 tint on the caller's own row", async () => {
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Alice Admin")).toBeInTheDocument());
    const aliceRow = screen.getByText("Alice Admin").closest("tr")!;
    expect(aliceRow.className).toContain("bg-accent/30");
  });
});

describe("UsersPage — Display Name column", () => {
  it("renders a Display Name column header", async () => {
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Display Name")).toBeInTheDocument());
  });

  it("renders each user's display name in its row", async () => {
    renderWithProviders(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByText("Alice Admin")).toBeInTheDocument();
      expect(screen.getByText("Bob Editor")).toBeInTheDocument();
    });
  });
});

describe("UsersPage — Role column shows the role name, not the slug", () => {
  it("renders the role name for each user", async () => {
    renderWithProviders(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByText("Super Admin")).toBeInTheDocument();
      expect(screen.getByText("Editor")).toBeInTheDocument();
    });
  });

  it("does not render the raw role slug", async () => {
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    expect(screen.queryByText("super_admin")).not.toBeInTheDocument();
  });
});

describe("UsersPage — dynamic role hierarchy (canManage gating)", () => {
  it("shows manage controls for a row whose role level is below the caller's", async () => {
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Bob Editor")).toBeInTheDocument());
    const bobRow = screen.getByText("Bob Editor").closest("tr");
    expect(bobRow).not.toBeNull();
    expect(bobRow!.querySelector("button")).not.toBeNull();
  });

  it("hides manage controls for the caller's own row", async () => {
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Alice Admin")).toBeInTheDocument());
    const aliceRow = screen.getByText("Alice Admin").closest("tr");
    expect(aliceRow!.querySelector("button")).toBeNull();
  });

  it("hides manage controls for a peer/higher role level than the caller", async () => {
    mockUseAuth.mockReturnValue({ role: editorRole, permissions: [], userId: "u2", loading: false, login: vi.fn(), logout: vi.fn() });
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Alice Admin")).toBeInTheDocument());
    const aliceRow = screen.getByText("Alice Admin").closest("tr");
    expect(aliceRow!.querySelector("button")).toBeNull();
  });

  it("only offers roles below the caller's own level in the role-change dropdown", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Bob Editor")).toBeInTheDocument());

    const bobRow = screen.getByText("Bob Editor").closest("tr")!;
    await user.click(bobRow.querySelector("[role='combobox']")!);

    await waitFor(() => expect(screen.getByRole("option", { name: "Editor" })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "Guest" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Super Admin" })).not.toBeInTheDocument();
  });

  it("hides both controls for a manageable row when the caller holds neither permission slug", async () => {
    mockUseAuth.mockReturnValue({ role: superAdminRole, permissions: [], userId: "u1", loading: false, login: vi.fn(), logout: vi.fn() });
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Bob Editor")).toBeInTheDocument());
    const bobRow = screen.getByText("Bob Editor").closest("tr")!;
    expect(bobRow.querySelector("[role='combobox']")).toBeNull();
    expect(bobRow.querySelector("button")).toBeNull();
  });

  it("shows only the role-change dropdown when the caller holds user:role_manager but not user:manager", async () => {
    mockUseAuth.mockReturnValue({ role: superAdminRole, permissions: ["user:role_manager"], userId: "u1", loading: false, login: vi.fn(), logout: vi.fn() });
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Bob Editor")).toBeInTheDocument());
    const bobRow = screen.getByText("Bob Editor").closest("tr")!;
    expect(bobRow.querySelector("[role='combobox']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("shows only the Delete button when the caller holds user:manager but not user:role_manager", async () => {
    mockUseAuth.mockReturnValue({ role: superAdminRole, permissions: ["user:manager"], userId: "u1", loading: false, login: vi.fn(), logout: vi.fn() });
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Bob Editor")).toBeInTheDocument());
    const bobRow = screen.getByText("Bob Editor").closest("tr")!;
    expect(bobRow.querySelector("[role='combobox']")).toBeNull();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("sends PATCH /users/:id/role with the selected roleId on role change", async () => {
    const user = userEvent.setup();
    let capturedBody: unknown;
    mock.onPatch("/users/u2/role").reply((config) => {
      capturedBody = JSON.parse(config.data);
      return [200, { ...usersResponse[1], roleId: "r3" }];
    });
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(screen.getByText("Bob Editor")).toBeInTheDocument());

    const bobRow = screen.getByText("Bob Editor").closest("tr")!;
    await user.click(bobRow.querySelector("[role='combobox']")!);
    const guestOption = await screen.findByRole("option", { name: "Guest" });
    await user.click(guestOption);

    await waitFor(() => expect(capturedBody).toEqual({ roleId: "r3" }));
  });
});
