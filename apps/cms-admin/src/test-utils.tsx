import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderWithProviders(ui: ReactElement, { initialEntries = ["/"], ...options }: { initialEntries?: string[] } & RenderOptions = {}) {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

// Stubs global fetch so any HealthProvider mounted in the tree resolves /health as ok almost
// immediately, letting AuthContext's health-gated bootstrap effect actually fire.
// Callers must add `afterEach(() => vi.unstubAllGlobals())`.
export function stubHealthyPing() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
}

// eslint-disable-next-line react-refresh/only-export-components
export * from "@testing-library/react";
