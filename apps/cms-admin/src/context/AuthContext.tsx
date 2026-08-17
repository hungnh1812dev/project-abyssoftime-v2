import axios from "axios";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { useHealthStatus } from "@/context/HealthContext";
import type { RoleItem } from "@/hooks/useRoles";
import { api, onSessionExpired, setAccessToken } from "@/lib/api";

// Delays between mount-time session retries on a transient failure (network
// error, 5xx, 429) — not a definitive 401. Sized to ride out a cold-start
// backend.
// eslint-disable-next-line react-refresh/only-export-components
export const MOUNT_REFRESH_RETRY_DELAYS_MS = [2000, 5000, 10000];

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export interface MeUser {
  documentId: string;
  email: string;
  name: string;
  username: string;
  accountType: boolean;
  verified: boolean;
  roleId: string | null;
  role: RoleItem | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  user: MeUser | null;
  loading: boolean;
}

interface AuthContextValue {
  user: MeUser | null;
  role: RoleItem | null;
  userId: string | null;
  displayName: string | null;
  permissions: string[];
  loading: boolean;
  login: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const LOGGED_OUT_STATE: AuthState = { user: null, loading: false };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  const mountedRef = useRef(true);
  const startedRef = useRef(false);
  const { status: healthStatus } = useHealthStatus();

  const fetchMe = useCallback(async () => {
    const response = await api.get<MeUser>("/auth/me");
    return response.data;
  }, []);

  // No client-readable signal indicates whether a session exists — the
  // access token lives only in memory (lost on reload) and the refresh
  // token is an HttpOnly cookie — so every mount attempts a silent,
  // cookie-only refresh (which also hands back a fresh accessToken, set
  // here before fetchMe() so its Authorization header is populated)
  // followed by GET /auth/me to hydrate identity/role/permissions. A 401
  // from either call definitively means "no session" and logs out
  // immediately. Anything else (network error, 5xx, 429) is a transient
  // failure — most commonly a cold-start backend — and gets retried before
  // giving up, so a live session isn't discarded just because the server
  // was briefly unreachable.
  const attemptMountSession = useCallback(async () => {
    for (let attempt = 0; mountedRef.current; attempt++) {
      try {
        const refreshResponse = await api.post<{ accessToken: string }>("/auth/refresh", undefined, {
          _retried: true,
          headers: { "Cache-Control": "no-cache, no-store" },
        } as object);
        setAccessToken(refreshResponse.data.accessToken);
        const user = await fetchMe();
        if (!mountedRef.current) return;
        setState({ user, loading: false });
        return;
      } catch (error) {
        if (!mountedRef.current) return;

        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const isDefinitiveNoSession = status === 401;
        const delayMs = MOUNT_REFRESH_RETRY_DELAYS_MS[attempt];

        if (isDefinitiveNoSession || delayMs === undefined) {
          setState(LOGGED_OUT_STATE);
          return;
        }

        await sleep(delayMs);
      }
    }
  }, [fetchMe]);

  useEffect(() => {
    mountedRef.current = true;

    onSessionExpired(() => {
      if (mountedRef.current) setState(LOGGED_OUT_STATE);
    });

    return () => {
      mountedRef.current = false;
      onSessionExpired(null);
    };
  }, []);

  // Gated on health so no session request fires until cms-api is confirmed
  // ready; startedRef ensures this runs exactly once per app load, so a
  // later health flap (unhealthy then healthy again during the steady-state
  // keep-alive ping) never re-triggers the bootstrap and spuriously logs an
  // active user out.
  useEffect(() => {
    if (healthStatus !== "healthy" || startedRef.current) return;
    startedRef.current = true;
    void attemptMountSession();
  }, [healthStatus, attemptMountSession]);

  // Called after a successful POST /auth/login with the accessToken from its
  // response body (LoginPage owns that call). The token is set here, before
  // fetchMe(), so GET /auth/me's Authorization header is already populated.
  const login = useCallback(
    async (accessToken: string) => {
      setAccessToken(accessToken);
      const user = await fetchMe();
      setState({ user, loading: false });
    },
    [fetchMe],
  );

  const logout = useCallback(async () => {
    setState(LOGGED_OUT_STATE);
    setAccessToken(null);
    try {
      await api.post("/auth/logout");
    } catch {
      // refresh cookie cleared server-side on a best-effort basis
    }
  }, []);

  const value: AuthContextValue = {
    user: state.user,
    role: state.user?.role ?? null,
    userId: state.user?.documentId ?? null,
    displayName: state.user?.name ?? null,
    permissions: state.user?.role?.permissions ?? [],
    loading: state.loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
