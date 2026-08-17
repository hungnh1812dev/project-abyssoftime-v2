import { render, screen, waitFor } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BootOverlay } from "@/components/BootOverlay";
import { AuthProvider } from "@/context/AuthContext";
import { HealthProvider } from "@/context/HealthContext";
import { api, setAccessToken } from "@/lib/api";

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
  vi.unstubAllGlobals();
  setAccessToken(null);
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderBootOverlay() {
  render(
    <HealthProvider>
      <AuthProvider>
        <BootOverlay />
      </AuthProvider>
    </HealthProvider>,
  );
}

function overlayVisible() {
  return screen.getByRole("alert").className.includes("opacity-100");
}

describe("BootOverlay", () => {
  it("stays visible while both health and the mount-time session check are still resolving", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(deferred<{ ok: boolean }>().promise));
    mock.onPost("/auth/refresh").reply(() => deferred<[number, unknown]>().promise);

    renderBootOverlay();

    expect(overlayVisible()).toBe(true);
  });

  it("stays visible once health is healthy but the mount-time session check is still loading", async () => {
    const health = deferred<{ ok: boolean }>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(health.promise));
    mock.onPost("/auth/refresh").reply(() => deferred<[number, unknown]>().promise);

    renderBootOverlay();
    expect(overlayVisible()).toBe(true);

    health.resolve({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(overlayVisible()).toBe(true);
  });

  it("hides once health is healthy and the mount-time session check has resolved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    mock.onPost("/auth/refresh").reply(401);

    renderBootOverlay();

    await waitFor(() => expect(overlayVisible()).toBe(false));
  });

  it("stays visible if health later flaps unhealthy even after the mount-time session check settled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    mock.onPost("/auth/refresh").reply(401);

    renderBootOverlay();
    await waitFor(() => expect(overlayVisible()).toBe(false));

    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(overlayVisible()).toBe(true));
  });
});
