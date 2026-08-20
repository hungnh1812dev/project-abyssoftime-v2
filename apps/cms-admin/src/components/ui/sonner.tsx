import type { CSSProperties } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

// Sonner's default toast is a near-white card floating on this app's near-white
// page background (measured ~1.1:1 contrast — effectively invisible without its
// faint shadow). These vars mirror the app's existing semantic-alert convention
// (bg-<color>/10 + text-<color>-text, see badge.tsx / auth page alert banners)
// so toast type is legible against the page, not just against its own edge.
const toastThemeVars = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "color-mix(in oklab, var(--foreground) 12%, var(--popover))",
  "--success-bg": "color-mix(in oklab, var(--success) 10%, var(--popover))",
  "--success-border": "var(--success)",
  "--success-text": "var(--success-text)",
  "--warning-bg": "color-mix(in oklab, var(--warning) 12%, var(--popover))",
  "--warning-border": "var(--warning-text)",
  "--warning-text": "var(--warning-text)",
  "--error-bg": "color-mix(in oklab, var(--destructive) 10%, var(--popover))",
  "--error-border": "var(--destructive)",
  "--error-text": "var(--destructive)",
  "--info-bg": "var(--primary-muted)",
  "--info-border": "var(--primary)",
  "--info-text": "var(--primary)",
} as CSSProperties;

function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      richColors
      style={toastThemeVars}
      toastOptions={{
        style: {
          boxShadow: "0 12px 28px -6px rgb(0 0 0 / 0.22), 0 4px 10px -4px rgb(0 0 0 / 0.14)",
        },
        classNames: {
          toast: "border-l-4!",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
