import { useMutation, useQuery } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useHealthStatus } from "@/context/HealthContext";
import { api } from "@/lib/api";

interface LoginFields {
  email: string;
  password: string;
  rememberMe: boolean;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { status } = useHealthStatus();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Gated on health so this doesn't hit the API before cms-api is confirmed ready — BootOverlay
  // visually covers this page until then, but that alone doesn't stop it from mounting and firing
  // its own queries underneath.
  const { data: hasUsersData, isLoading: hasUsersLoading } = useQuery({
    queryKey: ["auth-has-users"],
    queryFn: () => api.get<{ hasUsers: boolean }>("/auth/has-users").then((response) => response.data),
    staleTime: 30_000,
    enabled: status === "healthy",
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFields>();

  const mutation = useMutation({
    mutationFn: (data: LoginFields) => api.post<{ accessToken: string }>("/auth/login", data),
    onSuccess: async (response) => {
      await login(response.data.accessToken);
      navigate("/admin");
    },
    onError: (error: unknown) => {
      const status = (error as AxiosError).response?.status;
      if (status === 403) {
        setErrorMsg("Your email isn't verified yet. Check your inbox for the verification code.");
      } else {
        setErrorMsg("Invalid email or password.");
      }
    },
  });

  if (status !== "healthy" || hasUsersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (hasUsersData && !hasUsersData.hasUsers) {
    return <Navigate to="/register" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-muted-foreground text-sm">Enter your credentials to continue</p>
        </div>

        {errorMsg && (
          <div role="alert" className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-4 py-3 text-sm">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register("email", {
                required: "Email is required",
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" },
              })}
            />
            {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link to="/forgot-password" className="text-muted-foreground text-xs underline-offset-4 hover:underline">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register("password", {
                required: "Password is required",
                minLength: { value: 8, message: "Password must be at least 8 characters" },
              })}
            />
            {errors.password && <p className="text-destructive text-xs">{errors.password.message}</p>}
          </div>

          <div className="flex items-center gap-2">
            <input id="rememberMe" type="checkbox" className="border-border h-4 w-4 rounded" {...register("rememberMe")} />
            <Label htmlFor="rememberMe" className="cursor-pointer text-sm font-normal">
              Stay logged in
            </Label>
          </div>

          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="text-muted-foreground text-center text-sm">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="text-primary underline-offset-4 hover:underline">
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
}
