"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { stripLocale } from "@/lib/nav/strip-locale";
import { cn } from "@/lib/utils";
import type { HeaderNavItem } from "@/views/header/header.types";

interface HeaderNavProps {
  nav: HeaderNavItem[];
}

const isActive = (currentPath: string, item: HeaderNavItem): boolean => {
  const matches = (href: string) =>
    href === "/"
      ? currentPath === "" || currentPath === "/"
      : currentPath === href;
  return (
    matches(item.link) || item.subNavigations.some((sub) => matches(sub.link))
  );
};

const HeaderNav: React.FC<HeaderNavProps> = ({ nav }) => {
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.locale as string) ?? "en";
  const currentPath = stripLocale(pathname, locale);

  const toHref = (link: string) =>
    link === "/" ? `/${locale}` : `/${locale}${link}`;

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {nav.map((item) =>
        item.subNavigations.length > 0 ? (
          <DropdownMenu
            key={`${item.title.toLowerCase().replace(/\s+/g, "-")}-${item.link}`}
          >
            <DropdownMenuTrigger
              className={cn(
                "flex items-center gap-1 rounded-md px-3 py-2 text-sm outline-none transition-colors",
                isActive(currentPath, item)
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.title}
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem asChild>
                <Link href={toHref(item.link)}>{item.title}</Link>
              </DropdownMenuItem>
              {item.subNavigations.map((sub) => (
                <DropdownMenuItem key={sub.link} asChild>
                  <Link href={toHref(sub.link)}>{sub.title}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Link
            key={item.link}
            href={toHref(item.link)}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors",
              isActive(currentPath, item)
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.title}
          </Link>
        ),
      )}
    </nav>
  );
};

export { HeaderNav };
