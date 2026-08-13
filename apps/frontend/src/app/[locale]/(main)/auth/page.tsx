import type { Metadata } from "next";

import AuthPage from "@/views/auth/AuthPage";

export const metadata: Metadata = {
  title: "Đăng nhập",
};

export default async function AuthIndexPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  return <AuthPage returnTo={returnTo ?? "/"} />;
}
