"use client";

import { Lock } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeReturnTo } from "@/lib/auth/safe-return-to";

interface AuthPageProps {
  returnTo: string;
}

// Keyed by the `code` on CredentialsSignin (and its `UnverifiedAccountError` subclass, see
// auth.config.ts) — anything else (network hiccup, misconfiguration) falls back to a generic
// message rather than leaking internals.
const ERROR_MESSAGES: Record<string, string> = {
  unverified: "Tài khoản chưa được xác thực. Vui lòng kiểm tra email.",
  credentials: "Email hoặc mật khẩu không đúng.",
  // Deliberately does not say "thử lại" (try again) — that wording is what drives the retry burst
  // this error exists to stop; telling the user to wait is the fix.
  rate_limited: "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi khoảng 1 phút rồi thử lại.",
};
const FALLBACK_ERROR_MESSAGE = "Đăng nhập không thành công. Vui lòng thử lại.";

const AuthPage = ({ returnTo }: AuthPageProps) => {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    // redirect: false keeps this a normal form submit with an inline error instead of Auth.js's
    // default navigation to `?error=CredentialsSignin`.
    const result = await signIn("credentials", { email, password, rememberMe, redirect: false });

    setIsPending(false);

    if (!result || result.error) {
      setError(ERROR_MESSAGES[result?.code ?? ""] ?? FALLBACK_ERROR_MESSAGE);
      return;
    }

    router.push(safeReturnTo(returnTo));
    router.refresh();
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mb-2 flex justify-center">
            <Lock className="h-8 w-8 text-foreground/40" />
          </div>
          <CardTitle>Đăng nhập</CardTitle>
          <CardDescription>Nhập email và mật khẩu để tiếp tục</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              type="email"
              name="email"
              placeholder="you@example.com"
              autoFocus
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Input
              type="password"
              name="password"
              placeholder="••••••"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className="flex items-center gap-2">
              <Checkbox id="rememberMe" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked === true)} />
              <Label htmlFor="rememberMe" className="cursor-pointer font-normal">
                Ghi nhớ đăng nhập
              </Label>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Đang đăng nhập..." : "Đăng nhập"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthPage;
