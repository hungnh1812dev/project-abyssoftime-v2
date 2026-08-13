"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { stripLocale } from "@/lib/nav/strip-locale";
import { cn } from "@/lib/utils";
import type { HeaderNavItem } from "@/views/header/header.types";

interface HeaderMobileMenuProps {
  nav: HeaderNavItem[];
}

const isActive = (currentPath: string, href: string): boolean => {
  if (href === "/") {
    return currentPath === "" || currentPath === "/";
  }
  return currentPath === href;
};

const HeaderMobileMenu: React.FC<HeaderMobileMenuProps> = ({ nav }) => {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.locale as string) ?? "en";
  const currentPath = stripLocale(pathname, locale);

  const toHref = (link: string) => (link === "/" ? `/${locale}` : `/${locale}${link}`);

  return (
    <>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <nav className="mt-6 flex flex-col gap-1">
            {nav.map((item) => (
              <React.Fragment key={item.link}>
                <Link
                  href={toHref(item.link)}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center rounded-md px-3 py-2.5 text-sm transition-colors",
                    isActive(currentPath, item.link) ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}>
                  <span>{item.title}</span>
                </Link>
                {item.subNavigations.map((sub) => (
                  <Link
                    key={sub.link}
                    href={toHref(sub.link)}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center rounded-md py-2 pl-6 pr-3 text-sm transition-colors",
                      isActive(currentPath, sub.link) ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}>
                    <span>{sub.title}</span>
                  </Link>
                ))}
              </React.Fragment>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
};

export { HeaderMobileMenu };
