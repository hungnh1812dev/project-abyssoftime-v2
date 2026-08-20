import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import type { MediaAsset } from "@/types/cms";

interface UploadArgs {
  file: File;
}

const KEYS = {
  all: ["media"] as const,
};

// GET /media is not paginated — it returns every asset, newest first.
export function useMediaList() {
  return useQuery<MediaAsset[]>({
    queryKey: KEYS.all,
    queryFn: () => api.get<MediaAsset[]>("/media").then((response) => response.data),
  });
}

export function useUploadMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file }: UploadArgs) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return api.post<MediaAsset>("/media/upload", form).then((response) => response.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Uploaded");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Upload failed"));
    },
  });
}

export function useDeleteMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/media/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.all });
      toast.success("Deleted");
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Delete failed"));
    },
  });
}
