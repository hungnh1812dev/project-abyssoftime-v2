"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

interface LoginButtonProps {
  label: string;
}

const LoginButton = ({ label }: LoginButtonProps) => {
  const pathname = usePathname();

  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`/auth?returnTo=${encodeURIComponent(pathname)}`}>{label}</Link>
    </Button>
  );
};

export default LoginButton;
