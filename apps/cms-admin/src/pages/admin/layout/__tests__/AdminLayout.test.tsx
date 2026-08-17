import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider, SidebarShell } from "@/components/sidebar";
import { AuthProvider } from "@/context/AuthContext";
import type { MeUser } from "@/context/AuthContext";
import { HealthProvider } from "@/context/HealthContext";
import { api } from "@/lib/api";
import { TopBar } from "@/pages/admin/layout/TopBar";
import { renderWithProviders, stubHealthyPing } from "@/test-utils";
import type { ContentType } from "@/types/cms";

function makeMeUser(overrides: Partial<MeUser> = {}): MeUser {
  return {
    documentId: "u1",
    email: "admin@example.com",
    name: "Jane Admin",
    username: "admin",
    accountType: true,
    verified: true,
    roleId: "r1",
    role: {
      documentId: "r1",
      name: "Super Admin",
      slug: "super_admin",
      permissions: ["media:read", "user:read", "api_token:manager", "role:manager", "permission:manager"],
      level: 100,
      isDefault: true,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const contentTypes: ContentType[] = [
  { documentId: "d1", name: "Blog", slug: "blog", kind: "collection", draftToPublish: true, fields: [], listFields: [], createdAt: "", updatedAt: "" },
  { documentId: "d2", name: "About", slug: "about", kind: "single", draftToPublish: true, fields: [], listFields: [], createdAt: "", updatedAt: "" },
];

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  stubHealthyPing();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderSidebar(user: MeUser = makeMeUser()) {
  mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
  mock.onGet("/auth/me").reply(200, user);
  return renderWithProviders(
    <HealthProvider>
      <AuthProvider>
        <SidebarProvider>
          <SidebarShell />
        </SidebarProvider>
      </AuthProvider>
    </HealthProvider>,
    { initialEntries: ["/admin"] },
  );
}

describe("Sidebar", () => {
  it("renders content type names fetched from the API", async () => {
    mock.onGet("/content-types").reply(200, contentTypes);
    renderSidebar();
    await waitFor(() => expect(screen.getByText("Blog")).toBeInTheDocument());
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("renders nav links pointing to new content-type routes by kind", async () => {
    mock.onGet("/content-types").reply(200, contentTypes);
    renderSidebar();
    await waitFor(() => expect(screen.getByRole("link", { name: "Blog" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute("href", "/admin/content-type/collection-type/blog");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/admin/content-type/single-type/about");
  });

  it("renders no content-type links when no content types exist", async () => {
    mock.onGet("/content-types").reply(200, []);
    renderSidebar();
    await waitFor(() => expect(screen.getByRole("link", { name: /media library/i })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Blog" })).toBeNull();
    expect(screen.queryByRole("link", { name: "About" })).toBeNull();
  });

  it("groups content types into Single Types and Collection Types sections", async () => {
    mock.onGet("/content-types").reply(200, contentTypes);
    renderSidebar();

    await waitFor(() => expect(screen.getByText("Blog")).toBeInTheDocument());

    const singleHeading = screen.getByText("Single Types");
    const collectionHeading = screen.getByText("Collection Types");
    const aboutLink = screen.getByRole("link", { name: "About" });
    const blogLink = screen.getByRole("link", { name: "Blog" });

    expect(singleHeading.compareDocumentPosition(aboutLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aboutLink.compareDocumentPosition(collectionHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(collectionHeading.compareDocumentPosition(blogLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("omits a section heading when no content type of that kind exists", async () => {
    mock.onGet("/content-types").reply(200, [contentTypes[0]]); // collection only
    renderSidebar();

    await waitFor(() => expect(screen.getByText("Blog")).toBeInTheDocument());
    expect(screen.queryByText("Single Types")).not.toBeInTheDocument();
    expect(screen.getByText("Collection Types")).toBeInTheDocument();
  });

  it("renders a Settings section with a Media Library link to /admin/settings/media", async () => {
    mock.onGet("/content-types").reply(200, []);
    renderSidebar();

    await waitFor(() => expect(screen.getByRole("link", { name: /media library/i })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /media library/i })).toHaveAttribute("href", "/admin/settings/media");
  });

  it("renders a Logout button", async () => {
    mock.onGet("/content-types").reply(200, []);
    renderSidebar();
    await waitFor(() => expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument());
  });

  it("calls POST /auth/logout when Logout is clicked", async () => {
    mock.onGet("/content-types").reply(200, []);
    mock.onPost("/auth/logout").reply(200, { message: "Logged out" });
    const user = userEvent.setup();
    renderSidebar();
    await waitFor(() => expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /logout/i }));
    await waitFor(() => expect(mock.history.post.some((request) => request.url === "/auth/logout")).toBe(true));
  });
});

describe("TopBar", () => {
  it("renders breadcrumbs", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
    mock.onGet("/auth/me").reply(200, makeMeUser());
    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <SidebarProvider>
            <TopBar />
          </SidebarProvider>
        </AuthProvider>
      </HealthProvider>,
      { initialEntries: ["/admin/settings/media"] },
    );
    await waitFor(() => expect(screen.getByText("Home")).toBeInTheDocument());
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Media")).toBeInTheDocument();
  });
});
