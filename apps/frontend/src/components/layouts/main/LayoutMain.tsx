import React from "react";

import { SessionGuard } from "@/components/auth/SessionGuard";
import { HeaderBar } from "@/components/layouts/header/HeaderBar";
import { HealthGate } from "@/components/layouts/main/HealthGate";
import { cn } from "@/lib/utils";

interface LayoutMainProps {
  className?: string;
  children?: React.ReactNode;
  locale: string;
}

const LayoutMain: React.FC<LayoutMainProps> = ({ children, className, locale }) => {
  return (
    <main className={cn("bg-background text-foreground", className)}>
      <SessionGuard>
        <HeaderBar locale={locale} />
        <HealthGate>{children}</HealthGate>
      </SessionGuard>
    </main>
  );
};

export default LayoutMain;
