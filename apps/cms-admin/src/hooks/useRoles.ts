import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";

export interface RoleItem {
  documentId: string;
  name: string;
  slug: string;
  permissions: string[];
  level: number;
  isDefault: boolean;
}

export interface CreateRoleInput {
  name: string;
  slug: string;
  permissions: string[];
  level: number;
}

export interface UpdateRoleInput {
  name?: string;
  permissions?: string[];
  level?: number;
}

const KEYS = {
  all: ["roles"] as const,
};

export function useRoleList() {
  return useQuery<RoleItem[]>({
    queryKey: KEYS.all,
    queryFn: () => api.get<RoleItem[]>("/roles").then((response) => response.data),
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRoleInput) => api.post<RoleItem>("/roles", data).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Role created");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to create role"));
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, data }: { documentId: string; data: UpdateRoleInput }) => api.put<RoleItem>(`/roles/${documentId}`, data).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Role updated");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to update role"));
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.delete(`/roles/${documentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Role deleted");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to delete role"));
    },
  });
}
