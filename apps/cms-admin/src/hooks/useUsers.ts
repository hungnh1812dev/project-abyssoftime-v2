import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";

export interface UserItem {
  documentId: string;
  email: string;
  name: string;
  username: string;
  accountType: boolean;
  verified: boolean;
  roleId: string | null;
  createdAt: string;
  updatedAt: string;
}

const KEYS = {
  all: ["users"] as const,
};

// GET /users is not paginated — it returns every user.
export function useUserList() {
  return useQuery<UserItem[]>({
    queryKey: KEYS.all,
    queryFn: () => api.get<UserItem[]>("/users").then((response) => response.data),
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string }) => api.patch<UserItem>(`/users/${id}/role`, { roleId }).then((response) => response.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Role updated");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to update role"));
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("User deleted");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to delete user"));
    },
  });
}
