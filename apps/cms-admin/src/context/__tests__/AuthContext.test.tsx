import { act, screen, waitFor } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, type MeUser, MOUNT_REFRESH_RETRY_DELAYS_MS, useAuth } from "@/context/AuthContext";
import { HealthProvider } from "@/context/HealthContext";
import { api, setAccessToken } from "@/lib/api";
import { renderWithProviders, stubHealthyPing } from "@/test-utils";

function makeMeUser(overrides: Partial<MeUser> = {}): MeUser {
  return {
    documentId: "u1",
    email: "admin@example.com",
    name: "Admin",
    username: "admin",
    accountType: true,
    verified: true,
    roleId: "r1",
    role: { documentId: "r1", name: "Admin", slug: "admin", permissions: ["document:read", "document:create"], level: 50, isDefault: true },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let mock: MockAdapter;

// The retry delays are sized (seconds) to ride out a real cold start, which
// would make these tests slow. Shrink them in place for the test run — the
// array is exported as a mutable module binding for exactly this purpose.
const PROD_RETRY_DELAYS_MS = [...MOUNT_REFRESH_RETRY_DELAYS_MS];

beforeEach(() => {
  mock = new MockAdapter(api);
  MOUNT_REFRESH_RETRY_DELAYS_MS.splice(0, MOUNT_REFRESH_RETRY_DELAYS_MS.length, 5, 5, 5);
  stubHealthyPing();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  MOUNT_REFRESH_RETRY_DELAYS_MS.splice(0, MOUNT_REFRESH_RETRY_DELAYS_MS.length, ...PROD_RETRY_DELAYS_MS);
  setAccessToken(null);
});

// Helper component to inspect auth context values
function AuthDisplay() {
  const { userId, role, permissions, loading } = useAuth();
  if (loading) return <span data-testid="loading">loading</span>;
  return (
    <div>
      <span data-testid="userId">{userId ?? "none"}</span>
      <span data-testid="role">{role?.slug ?? "none"}</span>
      <span data-testid="permissions">{permissions.length > 0 ? permissions.join(",") : "none"}</span>
    </div>
  );
}

describe("AuthProvider — mount-time session hydration", () => {
  it("resolves as unauthenticated when the mount-time cookie refresh fails", async () => {
    mock.onPost("/auth/refresh").reply(401);

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("userId")).toHaveTextContent("none"));
    expect(screen.getByTestId("role")).toHaveTextContent("none");
  });

  it("starts in loading state then resolves once mount-time session hydration settles", async () => {
    mock.onPost("/auth/refresh").reply(401);

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    expect(screen.getByTestId("loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("userId")).toHaveTextContent("none"));
  });

  it("retries a transient mount-time refresh failure (e.g. a cold-start 503) and hydrates once it succeeds", async () => {
    let callCount = 0;
    mock.onPost("/auth/refresh").reply(() => {
      callCount += 1;
      return callCount === 1 ? [503] : [200, { message: "Refresh successful" }];
    });
    mock.onGet("/auth/me").reply(200, makeMeUser());

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("admin"));
    expect(callCount).toBe(2);
  });

  it("gives up and logs out only after exhausting retries on a persistent transient failure", async () => {
    let callCount = 0;
    mock.onPost("/auth/refresh").reply(() => {
      callCount += 1;
      return [503];
    });

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("userId")).toHaveTextContent("none"));
    expect(callCount).toBe(MOUNT_REFRESH_RETRY_DELAYS_MS.length + 1);
  });

  it("hydrates identity + role + permissions from GET /auth/me after a successful mount-time refresh", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
    mock.onGet("/auth/me").reply(200, makeMeUser());

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("admin"));
    expect(screen.getByTestId("userId")).toHaveTextContent("u1");
    expect(screen.getByTestId("permissions")).toHaveTextContent("document:read,document:create");
  });

  it("captures the accessToken from the mount-time refresh and sends it as Authorization: Bearer on GET /auth/me", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful", accessToken: "mount-refresh-token" });
    mock.onGet("/auth/me").reply(200, makeMeUser());

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("admin"));
    const meRequest = mock.history.get.find((request) => request.url === "/auth/me");
    expect(meRequest?.headers?.Authorization).toBe("Bearer mount-refresh-token");
  });

  it("logs out if GET /auth/me fails even after a successful refresh (no separable identity source)", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
    mock.onGet("/auth/me").reply(401);

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("userId")).toHaveTextContent("none"));
  });
});

describe("AuthProvider — login()/logout()", () => {
  it("login(accessToken) sets the token, fetches GET /auth/me with it as Authorization: Bearer, and updates context", async () => {
    mock.onPost("/auth/refresh").reply(401);
    mock.onGet("/auth/me").reply(200, makeMeUser({ documentId: "u2", role: { documentId: "r2", name: "Guest", slug: "guest", permissions: [], level: 0, isDefault: true } }));

    function LoginTrigger() {
      const { login, userId, loading } = useAuth();
      if (loading) return <span data-testid="loading">loading</span>;
      return (
        <div>
          <span data-testid="userId">{userId ?? "none"}</span>
          <button onClick={() => void login("login-access-token")}>login</button>
        </div>
      );
    }

    const { getByRole } = renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <LoginTrigger />
        </AuthProvider>
      </HealthProvider>,
    );

    // Wait for the mount-time session bootstrap (gated on health) to settle as
    // unauthenticated before logging in — otherwise its late-arriving 401
    // could clobber the state login() is about to set.
    await waitFor(() => expect(screen.queryByTestId("loading")).not.toBeInTheDocument());
    await act(async () => getByRole("button", { name: "login" }).click());

    expect(screen.getByTestId("userId")).toHaveTextContent("u2");
    const meRequest = mock.history.get.find((request) => request.url === "/auth/me");
    expect(meRequest?.headers?.Authorization).toBe("Bearer login-access-token");
  });

  it("logout() clears context, clears the held access token, and calls POST /auth/logout", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful", accessToken: "session-token" });
    mock.onGet("/auth/me").reply(200, makeMeUser());
    let logoutCalled = false;
    mock.onPost("/auth/logout").reply(() => {
      logoutCalled = true;
      return [200, { message: "Logged out" }];
    });
    mock.onGet("/protected").reply(200, {});

    function LogoutTrigger() {
      const { logout, userId } = useAuth();
      return (
        <div>
          <span data-testid="userId">{userId ?? "none"}</span>
          <button onClick={() => void logout()}>logout</button>
        </div>
      );
    }

    const { getByRole } = renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <LogoutTrigger />
        </AuthProvider>
      </HealthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("userId")).not.toHaveTextContent("none"));
    await act(async () => getByRole("button", { name: "logout" }).click());

    await waitFor(() => expect(screen.getByTestId("userId")).toHaveTextContent("none"));
    expect(logoutCalled).toBe(true);

    await api.get("/protected");
    const protectedRequest = mock.history.get.find((request) => request.url === "/protected");
    expect(protectedRequest?.headers?.Authorization).toBeUndefined();
  });

  it("clears context when onSessionExpired fires mid-session", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
    mock.onGet("/auth/me").reply(200, makeMeUser());

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("admin"));

    // Simulate a mid-session 401 that api.ts's interceptor can't recover from.
    mock.onGet("/protected").reply(401);
    mock.onPost("/auth/refresh").reply(401);
    await expect(api.get("/protected")).rejects.toBeTruthy();

    await waitFor(() => expect(screen.getByTestId("userId")).toHaveTextContent("none"));
  });
});

describe("AuthProvider — health-status flap safety", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not re-trigger the mount-time session bootstrap when health flaps unhealthy then healthy again", async () => {
    mock.onPost("/auth/refresh").reply(200, { message: "Refresh successful" });
    mock.onGet("/auth/me").reply(200, makeMeUser());

    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(
      <HealthProvider>
        <AuthProvider>
          <AuthDisplay />
        </AuthProvider>
      </HealthProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("admin"));
    expect(mock.history.post.filter((request) => request.url === "/auth/refresh")).toHaveLength(1);

    // Flip health unhealthy (ping fails, retries every 10s), then back healthy.
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    fetchMock.mockResolvedValue({ ok: true } as Response);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // The flap must not re-run attemptMountSession() or disturb the already-hydrated session.
    expect(mock.history.post.filter((request) => request.url === "/auth/refresh")).toHaveLength(1);
    expect(screen.getByTestId("userId")).toHaveTextContent("u1");
    expect(screen.getByTestId("role")).toHaveTextContent("admin");

    vi.unstubAllGlobals();
  });
});
