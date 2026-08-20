import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";

export type ExpiresIn = "30m" | "1h" | "1d" | "1m" | "1y" | "never";

export interface AccessTokenItem {
  documentId: string;
  name: string;
  permissions: string[];
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface AccessTokenSecret extends AccessTokenItem {
  // Plaintext secret — present only on create/revoke responses, shown once.
  token: string;
}

const KEYS = {
  all: ["access-tokens"] as const,
};

// GET /access-tokens is not paginated — it returns every token (no secret).
export function useAccessTokenList() {
  return useQuery<AccessTokenItem[]>({
    queryKey: KEYS.all,
    queryFn: () => api.get<AccessTokenItem[]>("/access-tokens").then((response) => response.data),
  });
}

export function useCreateAccessToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; permissions: string[]; expiresIn: ExpiresIn }) =>
      api.post<AccessTokenSecret>("/access-tokens", data).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to create token"));
    },
  });
}

export function useRevokeAccessToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: { name?: string; permissions?: string[]; expiresIn?: ExpiresIn } }) =>
      api.post<AccessTokenSecret>(`/access-tokens/${id}/revoke`, data ?? {}).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Token revoked");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to revoke token"));
    },
  });
}

export function useDeleteAccessToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/access-tokens/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Token deleted");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to delete token"));
    },
  });
}
