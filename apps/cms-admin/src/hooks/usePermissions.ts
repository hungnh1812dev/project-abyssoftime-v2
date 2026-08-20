import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";

export interface PermissionItem {
  documentId: string;
  slug: string;
  name: string;
  description: string;
}

const KEYS = {
  all: ["permissions"] as const,
};

export function usePermissions() {
  return useQuery<PermissionItem[]>({
    queryKey: KEYS.all,
    queryFn: () => api.get<PermissionItem[]>("/permissions").then((response) => response.data),
  });
}

export function useCreatePermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { slug: string; name: string; description?: string }) => api.post<PermissionItem>("/permissions", data).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Permission created");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to create permission"));
    },
  });
}

export function useUpdatePermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, data }: { documentId: string; data: { name?: string; description?: string } }) =>
      api.put<PermissionItem>(`/permissions/${documentId}`, data).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Permission updated");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to update permission"));
    },
  });
}

export function useDeletePermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.delete(`/permissions/${documentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Permission deleted");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to delete permission"));
    },
  });
}
