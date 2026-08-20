import { AccessTokensPage } from "../AccessTokensPage";
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

const permissionsResponse = [
  { documentId: "p1", slug: "document:read", name: "Read Documents", description: "" },
  { documentId: "p2", slug: "document:create", name: "Create Documents", description: "" },
  { documentId: "p3", slug: "media:read", name: "Read Media", description: "" },
];

beforeEach(() => {
  mockUseAuth.mockReturnValue({ permissions: ["api_token:manager"] });
  mock = new MockAdapter(api);
  mock.onGet("/access-tokens").reply(200, []);
  mock.onGet("/permissions").reply(200, permissionsResponse);
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

async function openCreateDialog() {
  renderWithProviders(<AccessTokensPage />);
  const user = userEvent.setup();
  await waitFor(() => screen.getByText("Create new token"));
  await user.click(screen.getByText("Create new token"));
  return user;
}

describe("AccessTokensPage — DataTable styling", () => {
  it("gives the header row a dark sky-blue background", async () => {
    mock.onGet("/access-tokens").reply(200, [{ documentId: "t1", name: "Existing", permissions: [], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null }]);
    renderWithProviders(<AccessTokensPage />);
    await waitFor(() => expect(screen.getByText("Existing")).toBeInTheDocument());
    const headerRow = screen.getByText("Name", { selector: "th" }).closest("tr")!;
    expect(headerRow.className.split(/\s+/)).toContain("bg-sky-700");
  });
});

describe("AccessTokensPage — create dialog uses the shared permission catalog", () => {
  it("renders the permission tree grouped by resource, from the live catalog", async () => {
    await openCreateDialog();
    await waitFor(() => {
      expect(screen.getByText("Read Documents")).toBeInTheDocument();
      expect(screen.getByText("Create Documents")).toBeInTheDocument();
      expect(screen.getByText("Read Media")).toBeInTheDocument();
    });
  });

  it("allows creating a token with zero permissions selected", async () => {
    mock
      .onPost("/access-tokens")
      .reply(201, { documentId: "t1", name: "My Token", permissions: [], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null, token: "plaintext" });
    const user = await openCreateDialog();
    await waitFor(() => screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "My Token");
    await user.click(screen.getByRole("button", { name: /create token/i }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ name: "My Token", permissions: [], expiresIn: "never" });
  });

  it("submits the selected permission slugs and expiresIn on create", async () => {
    mock
      .onPost("/access-tokens")
      .reply(201, { documentId: "t1", name: "My Token", permissions: ["document:read"], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null, token: "plaintext-token" });

    const user = await openCreateDialog();
    await waitFor(() => screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "My Token");

    const readCheckbox = screen.getByText("Read Documents").closest("label")?.querySelector("input") as HTMLInputElement;
    await user.click(readCheckbox);
    await user.click(screen.getByRole("button", { name: /create token/i }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ name: "My Token", permissions: ["document:read"], expiresIn: "never" });
  });

  it("shows the plaintext token once after creation", async () => {
    mock
      .onPost("/access-tokens")
      .reply(201, { documentId: "t1", name: "My Token", permissions: [], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null, token: "plaintext-token" });

    const user = await openCreateDialog();
    await waitFor(() => screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "My Token");
    await user.click(screen.getByRole("button", { name: /create token/i }));

    await waitFor(() => expect(screen.getByText("plaintext-token")).toBeInTheDocument());
  });

  it("Create button stays disabled until a name is entered", async () => {
    await openCreateDialog();
    await waitFor(() => screen.getByRole("button", { name: /create token/i }));
    expect(screen.getByRole("button", { name: /create token/i })).toBeDisabled();
  });
});

describe("AccessTokensPage — token list", () => {
  it("renders permission badges using catalog names, not raw slugs", async () => {
    mock
      .onGet("/access-tokens")
      .reply(200, [{ documentId: "t1", name: "Existing", permissions: ["document:read", "media:read"], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null }]);
    renderWithProviders(<AccessTokensPage />);

    await waitFor(() => {
      expect(screen.getByText("Read Documents")).toBeInTheDocument();
      expect(screen.getByText("Read Media")).toBeInTheDocument();
      expect(screen.queryByText("document:read")).not.toBeInTheDocument();
    });
  });

  it("shows a new plaintext token once after Revoke", async () => {
    mock.onGet("/access-tokens").reply(200, [{ documentId: "t1", name: "Existing", permissions: [], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null }]);
    mock.onPost("/access-tokens/t1/revoke").reply(200, {
      documentId: "t1",
      name: "Existing",
      permissions: [],
      expiresAt: null,
      createdAt: "",
      updatedAt: "",
      updatedBy: null,
      token: "rotated-plaintext-token",
    });
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<AccessTokensPage />);

    await waitFor(() => screen.getByText("Existing"));
    await user.click(screen.getByRole("button", { name: /revoke/i }));

    await waitFor(() => expect(screen.getByText("rotated-plaintext-token")).toBeInTheDocument());
    confirmSpy.mockRestore();
  });

  it("deletes a token on Delete", async () => {
    mock.onGet("/access-tokens").reply(200, [{ documentId: "t1", name: "Existing", permissions: [], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null }]);
    mock.onDelete("/access-tokens/t1").reply(204);
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<AccessTokensPage />);

    await waitFor(() => screen.getByText("Existing"));
    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(mock.history.delete).toHaveLength(1));
    confirmSpy.mockRestore();
  });
});

describe("AccessTokensPage — dialog accessibility", () => {
  it("create-token dialog exposes an accessible title and description", async () => {
    await openCreateDialog();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Create Access Token" })).toBeInTheDocument();
      expect(screen.getByText("Generate a scoped API token for external integrations.")).toBeInTheDocument();
    });
  });

  it("reveal dialog shows the copy-now note, wired into aria-describedby, after creating a token", async () => {
    mock
      .onPost("/access-tokens")
      .reply(201, { documentId: "t1", name: "My Token", permissions: [], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null, token: "plaintext-token" });

    const user = await openCreateDialog();
    await waitFor(() => screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "My Token");
    await user.click(screen.getByRole("button", { name: /create token/i }));

    await waitFor(() => expect(screen.getByText("plaintext-token")).toBeInTheDocument());
    expect(screen.getByText("Copy this token now. It will not be shown again.")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });
});

describe("AccessTokensPage — permission gating", () => {
  it("enables Revoke and Delete when the caller holds api_token:manager", async () => {
    mock.onGet("/access-tokens").reply(200, [{ documentId: "t1", name: "Existing", permissions: [], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null }]);
    renderWithProviders(<AccessTokensPage />);

    await waitFor(() => screen.getByText("Existing"));
    expect(screen.getByRole("button", { name: /revoke/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /delete/i })).not.toBeDisabled();
  });

  it("disables Revoke and Delete when the caller lacks api_token:manager", async () => {
    mockUseAuth.mockReturnValue({ permissions: [] });
    mock.onGet("/access-tokens").reply(200, [{ documentId: "t1", name: "Existing", permissions: [], expiresAt: null, createdAt: "", updatedAt: "", updatedBy: null }]);
    renderWithProviders(<AccessTokensPage />);

    await waitFor(() => screen.getByText("Existing"));
    expect(screen.getByRole("button", { name: /revoke/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /delete/i })).toBeDisabled();
  });
});
