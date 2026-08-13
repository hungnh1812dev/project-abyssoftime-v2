import Link from "next/link";

import { auth } from "@/auth";
import LoginButton from "@/components/auth/LoginButton";
import UserMenu from "@/components/auth/UserMenu";
import { HeaderMobileMenu } from "@/components/layouts/header/HeaderMobileMenu";
import { HeaderNav } from "@/components/layouts/header/HeaderNav";
import { filterNavTree } from "@/lib/nav/nav-filter";
import { getHeader } from "@/views/header/header.service";

interface HeaderBarProps {
  locale: string;
}

async function HeaderBar({ locale }: HeaderBarProps) {
  const [header, session] = await Promise.all([getHeader(), auth()]);
  // Filtered server-side before the first byte is sent — a disallowed link must never appear in
  // the HTML at all (CSS-hiding it would still leak the link to view-source/devtools).
  const nav = filterNavTree(header?.nav ?? [], session?.user?.roleSlug);
  const author = header?.author;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 print:hidden">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center px-4 md:px-6">
        <Link href={`/${locale}`} className="mr-4 flex items-center gap-2 font-semibold">
          {header?.name ?? "Abyssoftime"}
        </Link>
        <HeaderNav nav={nav} />
        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
          {session?.user ? (
            <UserMenu name={session.user.name ?? session.user.email ?? "Account"} logoutLabel={author?.btnLogoutText ?? "Logout"} />
          ) : (
            <LoginButton label={author?.btnLoginText ?? "Login"} />
          )}
          <HeaderMobileMenu nav={nav} />
        </div>
      </div>
    </header>
  );
}

export { HeaderBar };
