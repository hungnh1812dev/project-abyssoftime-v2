import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";

import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { toast } from "sonner";
import type { Document } from "@/types/cms";

function onMutationError(error: unknown) {
  toast.error(apiErrorMessage(error, "Something went wrong"));
}

const KEYS = {
  document: (slug: string) => ["documents", "single-type", slug] as const,
};

export function useSingleTypeDocument(slug: string) {
  return useQuery({
    queryKey: KEYS.document(slug),
    queryFn: async () => {
      try {
        const response = await api.get<Document>(`/documents/single-type/${slug}`);
        return response.data;
      } catch (error) {
        const status = (error as AxiosError).response?.status;
        if (status === 404) return undefined;
        throw error;
      }
    },
    enabled: Boolean(slug),
    retry: (failureCount, error) => {
      if ((error as AxiosError).response?.status === 404) return false;
      return failureCount < 3;
    },
  });
}

export function useSaveSingleType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug, data }: { contentTypeSlug: string; data: Record<string, unknown> }) =>
      api.put<Document>(`/documents/single-type/${contentTypeSlug}`, { data }).then((response) => response.data),
    onSuccess: (result, { contentTypeSlug }) => {
      queryClient.invalidateQueries({ queryKey: KEYS.document(contentTypeSlug) });
      return result;
    },
    onError: onMutationError,
  });
}

export function usePublishSingleType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug }: { contentTypeSlug: string }) =>
      api.post<{ status: string }>(`/documents/single-type/${contentTypeSlug}/publish`).then((response) => response.data),
    onSuccess: (_, { contentTypeSlug }) => {
      queryClient.invalidateQueries({ queryKey: KEYS.document(contentTypeSlug) });
      toast.success("Published");
    },
    onError: onMutationError,
  });
}

export function useUnpublishSingleType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug }: { contentTypeSlug: string }) =>
      api.post<{ status: string }>(`/documents/single-type/${contentTypeSlug}/unpublish`).then((response) => response.data),
    onSuccess: (_, { contentTypeSlug }) => {
      queryClient.invalidateQueries({ queryKey: KEYS.document(contentTypeSlug) });
      toast.success("Unpublished");
    },
    onError: onMutationError,
  });
}
