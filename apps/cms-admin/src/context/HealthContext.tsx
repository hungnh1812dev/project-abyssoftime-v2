import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { ConnectionOverlay } from "@/components/ConnectionOverlay";

const PING_INTERVAL_HEALTHY = 14 * 60 * 1000;
const PING_INTERVAL_UNHEALTHY = 10 * 1000;
const PING_TIMEOUT = 5 * 1000;

type HealthStatus = "checking" | "healthy" | "unhealthy";

interface HealthContextValue {
  status: HealthStatus;
}

const HealthContext = createContext<HealthContextValue | null>(null);

export function HealthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<HealthStatus>("checking");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pingRef = useRef<() => void>(() => {});

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function pingHealth() {
    clearTimer();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const baseUrl = import.meta.env.VITE_API_URL || "";

    fetch(`${baseUrl}/health`, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timeoutId);
        if (!mountedRef.current) return;

        if (response.ok) {
          setStatus("healthy");
          timerRef.current = setTimeout(() => pingRef.current(), PING_INTERVAL_HEALTHY);
        } else {
          setStatus("unhealthy");
          timerRef.current = setTimeout(() => pingRef.current(), PING_INTERVAL_UNHEALTHY);
        }
      })
      .catch(() => {
        clearTimeout(timeoutId);
        if (!mountedRef.current) return;

        setStatus("unhealthy");
        timerRef.current = setTimeout(() => pingRef.current(), PING_INTERVAL_UNHEALTHY);
      });
  }

  useEffect(() => {
    pingRef.current = pingHealth;
  });

  useEffect(() => {
    mountedRef.current = true;
    pingRef.current();

    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        clearTimer();
      } else {
        pingRef.current();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <HealthContext.Provider value={{ status }}>
      {children}
      <ConnectionOverlay visible={status !== "healthy"} />
    </HealthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHealthStatus(): HealthContextValue {
  const context = useContext(HealthContext);
  if (!context) throw new Error("useHealthStatus must be used inside HealthProvider");
  return context;
}
