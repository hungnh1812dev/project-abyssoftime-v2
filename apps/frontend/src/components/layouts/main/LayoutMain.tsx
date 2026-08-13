import { SessionProvider } from "next-auth/react";
import React from "react";

import { auth } from "@/auth";
import { HeaderBar } from "@/components/layouts/header/HeaderBar";
import { HealthGate } from "@/components/layouts/main/HealthGate";
import { cn } from "@/lib/utils";

interface LayoutMainProps {
  className?: string;
  children?: React.ReactNode;
  locale: string;
}

// Seeding SessionProvider from the server's own auth() result (not left to fetch client-side) is
// what keeps the first paint correct — any client component under here can call useSession()
// without an initial anonymous flash.
async function LayoutMain({ children, className, locale }: LayoutMainProps) {
  const session = await auth();

  return (
    <main className={cn("bg-background text-foreground", className)}>
      <SessionProvider session={session}>
        <HeaderBar locale={locale} />
        <HealthGate>{children}</HealthGate>
      </SessionProvider>
    </main>
  );
}

export default LayoutMain;
