import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

import { BootOverlay } from "@/components/BootOverlay";
import { AuthProvider } from "@/context/AuthContext";
import { HealthProvider } from "@/context/HealthContext";
import { queryClient } from "@/lib/queryClient";
import { AppRouter } from "@/router";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HealthProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRouter />
            <BootOverlay />
          </AuthProvider>
        </BrowserRouter>
      </HealthProvider>
      <Toaster position="top-right" />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>,
);
