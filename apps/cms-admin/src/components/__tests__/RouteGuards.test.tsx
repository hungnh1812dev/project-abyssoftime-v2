import { screen, waitFor } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthProvider } from "@/context/AuthContext";
import type { MeUser } from "@/context/AuthContext";
import { HealthProvider } from "@/context/HealthContext";
import { api } from "@/lib/api";
import { renderWithProviders, stubHealthyPing } from "@/test-utils";

function makeMeUser(overrides: Partial<MeUser> = {}): MeUser {
  return {
    documentId: "u1",
    email: "user@example.com",
    name: "User",
    username: "user",
    accountType: true,
    verified: true,
    roleId: "r1",
    role: { documentId: "r1", name: "Admin", slug: "admin", permissions: [], level: 50, isDefault: true },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  stubHealthyPing();
});

afterEach(() => {
  mock.restore();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode, initialEntries = ["/"]) {
  return renderWithProviders(
    <HealthProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route path="/register" element={<p>Register page</p>} />
          <Route path="/403" element={<p>403 Forbidden</p>} />
          {ui}
        </Routes>
      </AuthProvider>
    </HealthProvider>,
    { initialEntries },
  );
}

describe("ProtectedRoute", () => {
  it("redirects to /login when not authenticated and has-users is true", async () => {
    mock.onPost("/auth/refresh").reply(401);
    mock.onGet("/auth/has-users").reply(200, { hasUsers: true });

    wrap(
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <p>Secret content</p>
          </ProtectedRoute>
        }
      />,
    );

    await waitFor(() => expect(screen.getByText("Login page")).toBeInTheDocument());
    expect(screen.queryByText("Secret content")).not.toBeInTheDocument();
  });

  it("redirects to /register when not authenticated and no users exist yet", async () => {
    mock.onPost("/auth/refresh").reply(401);
    mock.onGet("/auth/has-users").reply(200, { hasUsers: false });

    wrap(
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <p>Secret content</p>
          </ProtectedRoute>
        }
      />,
    );

    await waitFor(() => expect(screen.getByText("Register page")).toBeInTheDocument());
  });

  it("renders children when authenticated", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
    mock.onGet("/auth/me").reply(200, makeMeUser());

    wrap(
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <p>Secret content</p>
          </ProtectedRoute>
        }
      />,
    );

    await waitFor(() => expect(screen.getByText("Secret content")).toBeInTheDocument());
  });

  it("redirects to /403 when authenticated but below minLevel", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
    mock.onGet("/auth/me").reply(200, makeMeUser({ role: { documentId: "r2", name: "Guest", slug: "guest", permissions: [], level: 0, isDefault: true } }));

    wrap(
      <Route
        path="/"
        element={
          <ProtectedRoute minLevel={50}>
            <p>Admin content</p>
          </ProtectedRoute>
        }
      />,
    );

    await waitFor(() => expect(screen.getByText("403 Forbidden")).toBeInTheDocument());
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });

  it("renders children when authenticated and at/above minLevel", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
    mock.onGet("/auth/me").reply(200, makeMeUser());

    wrap(
      <Route
        path="/"
        element={
          <ProtectedRoute minLevel={50}>
            <p>Admin content</p>
          </ProtectedRoute>
        }
      />,
    );

    await waitFor(() => expect(screen.getByText("Admin content")).toBeInTheDocument());
  });
});
