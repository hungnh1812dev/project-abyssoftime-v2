import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/context/AuthContext";
import { HealthProvider } from "@/context/HealthContext";
import { api, setAccessToken } from "@/lib/api";
import { LoginPage } from "@/pages/auth/LoginPage";
import { renderWithProviders, stubHealthyPing } from "@/test-utils";

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onPost("/auth/refresh").reply(401);
  mock.onGet("/auth/has-users").reply(200, { hasUsers: true });
  stubHealthyPing();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setAccessToken(null);
});

function renderLogin() {
  return renderWithProviders(
    <HealthProvider>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </HealthProvider>,
  );
}

describe("LoginPage", () => {
  it("renders email and password fields with a submit button", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("links to /forgot-password", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText(/forgot password/i)).toBeInTheDocument());
    expect(screen.getByText(/forgot password/i).closest("a")).toHaveAttribute("href", "/forgot-password");
  });

  it("shows validation error for invalid email", async () => {
    const user = userEvent.setup();
    renderLogin();

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    });
  });

  it("shows validation error for password shorter than 8 characters", async () => {
    const user = userEvent.setup();
    renderLogin();

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "short");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least 8/i)).toBeInTheDocument();
    });
  });

  it("calls POST /auth/login and navigates to /admin on success", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/login").reply(200, { message: "Login successful", accessToken: "login-access-token" });
    mock.onGet("/auth/me").reply(200, {
      documentId: "u1",
      email: "user@example.com",
      name: "User",
      username: "user",
      accountType: true,
      verified: true,
      roleId: null,
      role: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    renderLogin();

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mock.history.post.some((request) => request.url === "/auth/login")).toBe(true);
    });
  });

  it("captures accessToken from the login response and sends it as Authorization: Bearer on the follow-up GET /auth/me", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/login").reply(200, { message: "Login successful", accessToken: "login-access-token" });
    mock.onGet("/auth/me").reply(200, {
      documentId: "u1",
      email: "user@example.com",
      name: "User",
      username: "user",
      accountType: true,
      verified: true,
      roleId: null,
      role: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    renderLogin();

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      const meRequest = mock.history.get.find((request) => request.url === "/auth/me");
      expect(meRequest?.headers?.Authorization).toBe("Bearer login-access-token");
    });
  });

  it("shows a generic invalid-credentials message on 401", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/login").reply(401, { message: "Invalid credentials" });
    renderLogin();

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/invalid email or password/i);
    });
  });

  it("shows a not-verified message on 403", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/login").reply(403, { message: "Email not verified" });
    renderLogin();

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
    await user.type(screen.getByLabelText(/email/i), "user@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/verification code/i);
    });
  });
});
