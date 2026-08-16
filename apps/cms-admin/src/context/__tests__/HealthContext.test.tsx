import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HealthProvider, useHealthStatus } from "@/context/HealthContext";

function HealthDisplay() {
  const { status } = useHealthStatus();
  return <span data-testid="health">{status}</span>;
}

function flushPromises() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function flushAll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

describe("HealthProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hides overlay once the initial health check resolves healthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();

    expect(screen.getByTestId("health")).toHaveTextContent("healthy");

    const overlay = screen.getByRole("alert");
    expect(overlay).toHaveClass("pointer-events-none");
    expect(overlay).toHaveClass("opacity-0");

    vi.unstubAllGlobals();
  });

  it("shows overlay while initial health check is still in flight", async () => {
    let resolveFetch: (value: { ok: boolean }) => void;
    const pendingFetch = new Promise<{ ok: boolean }>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingFetch));

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    // Fetch has been called but has not resolved yet — health status is unknown.
    const overlay = screen.getByRole("alert");
    expect(overlay).not.toHaveClass("pointer-events-none");
    expect(overlay).not.toHaveClass("opacity-0");

    resolveFetch!({ ok: true });
    await flushAll();
    vi.unstubAllGlobals();
  });

  it("shows overlay when ping fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();

    await waitFor(() => {
      expect(screen.getByTestId("health")).toHaveTextContent("unhealthy");
    });

    const overlay = screen.getByRole("alert");
    expect(overlay).not.toHaveClass("pointer-events-none");
    expect(overlay).not.toHaveClass("opacity-0");

    vi.unstubAllGlobals();
  });

  it("recovers and hides overlay when ping succeeds after failure", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("Network error"));
        return Promise.resolve({ ok: true });
      }),
    );

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();

    await waitFor(() => {
      expect(screen.getByTestId("health")).toHaveTextContent("unhealthy");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    await waitFor(() => {
      expect(screen.getByTestId("health")).toHaveTextContent("healthy");
    });

    const overlay = screen.getByRole("alert");
    expect(overlay).toHaveClass("opacity-0");

    vi.unstubAllGlobals();
  });

  it("retries every 10s on failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    vi.unstubAllGlobals();
  });

  it("schedules next ping in 14 minutes on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60 * 1000 - 10_000);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    vi.unstubAllGlobals();
  });

  it("clears timer on unmount", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("pauses ping when tab becomes hidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
    vi.unstubAllGlobals();
  });

  it("fires immediate ping when tab becomes visible", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await flushAll();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    vi.unstubAllGlobals();
  });

  it("treats non-200 response as failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    render(
      <HealthProvider>
        <HealthDisplay />
      </HealthProvider>,
    );

    await flushAll();

    await waitFor(() => {
      expect(screen.getByTestId("health")).toHaveTextContent("unhealthy");
    });

    vi.unstubAllGlobals();
  });
});
