import Link from "next/link";

import { HeaderMobileMenu } from "@/components/layouts/header/HeaderMobileMenu";
import { HeaderNav } from "@/components/layouts/header/HeaderNav";
import { getHeader } from "@/views/header/header.service";

interface HeaderBarProps {
  locale: string;
}

async function HeaderBar({ locale }: HeaderBarProps) {
  const header = await getHeader();
  const nav = header?.nav ?? [];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 print:hidden">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center px-4 md:px-6">
        <Link href={`/${locale}`} className="mr-4 flex items-center gap-2 font-semibold">
          {header?.name ?? "Abyssoftime"}
        </Link>
        <HeaderNav nav={nav} />
        <div className="flex flex-1 items-center justify-end md:flex-none">
          <HeaderMobileMenu nav={nav} />
        </div>
      </div>
    </header>
  );
}

export { HeaderBar };
