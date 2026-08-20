import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { SidebarContext, useSidebar } from "./SidebarContext";

interface SidebarGroupProps {
  icon: LucideIcon;
  label: string;
  storageKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SidebarGroup({ icon: Icon, label, storageKey, defaultOpen = true, children }: SidebarGroupProps) {
  const sidebarContext = useSidebar();
  const { collapsed } = sidebarContext;
  const fullKey = `sidebar-group-${storageKey}`;
  const location = useLocation();

  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(fullKey);
      return stored !== null ? stored === "true" : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(fullKey, String(open));
    } catch {
      /* noop */
    }
  }, [open, fullKey]);

  // Collapsed sidebar has no room for an inline accordion, so the group's
  // items would otherwise be unreachable. Surface them in a flyout instead.
  const [flyoutOpen, setFlyoutOpen] = useState(false);

  useEffect(() => {
    setFlyoutOpen(false);
  }, [location.pathname]);

  if (collapsed) {
    return (
      <DropdownMenu open={flyoutOpen} onOpenChange={setFlyoutOpen}>
        <DropdownMenuTrigger
          aria-label={label}
          className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center justify-center rounded-md px-0 py-2 text-sm font-semibold transition-colors">
          <Icon className="size-4 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={8} className="bg-sidebar text-sidebar-foreground ring-sidebar-border w-56">
          <div className="text-sidebar-muted px-1.5 py-1 text-xs font-medium">{label}</div>
          <SidebarContext.Provider value={{ ...sidebarContext, collapsed: false }}>
            <div className="space-y-0.5 px-0.5 pb-0.5">{children}</div>
          </SidebarContext.Provider>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const handleToggle = () => setOpen((prev) => !prev);

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={handleToggle}
        className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors">
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-90")} />
      </button>
      {open && <div className="space-y-0.5 pl-2">{children}</div>}
    </div>
  );
}
