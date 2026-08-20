import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import type { Document, ListedDocumentItem, PaginatedResponse } from "@/types/cms";

function onMutationError(error: unknown) {
  toast.error(apiErrorMessage(error, "Something went wrong"));
}

const KEYS = {
  list: (slug: string) => ["documents", "collection-type", slug] as const,
  detail: (slug: string, id: string) => ["documents", "collection-type", "detail", slug, id] as const,
};

// Note: system-column orderBy values are snake_case at the wire level ("id",
// "created_at", "updated_at", "document_id") even though the same columns
// come back camelCase in response bodies ("documentId", "createdAt") —
// confirmed against the live API, not documented in the written API
// reference. Content-type schema field names (e.g. "title") pass through
// as-is, unaffected by this.
export function useCollectionDocuments(slug: string, start: number, size: number, orderBy: string = "id", sortDir: "asc" | "desc" = "desc", search: string = "") {
  return useQuery({
    queryKey: [...KEYS.list(slug), start, size, orderBy, sortDir, search] as const,
    queryFn: () =>
      api
        .get<PaginatedResponse<ListedDocumentItem>>(`/documents/collection-type/${slug}`, {
          params: { start, size, orderBy, sortDir, search: search || undefined },
        })
        .then((response) => response.data),
    enabled: Boolean(slug),
  });
}

export function useCollectionDocument(slug: string, documentId: string) {
  return useQuery({
    queryKey: KEYS.detail(slug, documentId),
    queryFn: () => api.get<Document>(`/documents/collection-type/${slug}/${documentId}`).then((response) => response.data),
    enabled: Boolean(documentId),
  });
}

export function useCreateCollectionDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug, data }: { contentTypeSlug: string; data: Record<string, unknown> }) =>
      api.post<Document>(`/documents/collection-type/${contentTypeSlug}`, { data }).then((response) => response.data),
    onSuccess: (_, { contentTypeSlug }) => queryClient.invalidateQueries({ queryKey: KEYS.list(contentTypeSlug) }),
    onError: onMutationError,
  });
}

export function useUpdateCollectionDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug, id, data }: { contentTypeSlug: string; id: string; data: Record<string, unknown> }) =>
      api.put<Document>(`/documents/collection-type/${contentTypeSlug}/${id}`, { data }).then((response) => response.data),
    onSuccess: (result, { contentTypeSlug }) => {
      queryClient.invalidateQueries({ queryKey: KEYS.list(contentTypeSlug) });
      queryClient.invalidateQueries({ queryKey: KEYS.detail(contentTypeSlug, result.data.documentId) });
    },
    onError: onMutationError,
  });
}

export function useDeleteCollectionDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug, id }: { contentTypeSlug: string; id: string }) => api.delete(`/documents/collection-type/${contentTypeSlug}/${id}`),
    onSuccess: (_, { contentTypeSlug }) => queryClient.invalidateQueries({ queryKey: KEYS.list(contentTypeSlug) }),
    onError: onMutationError,
  });
}

interface BulkDeleteFailure {
  documentId: string;
  error?: string;
}

interface BulkDeleteResponse {
  deleted: string[];
  failed: BulkDeleteFailure[];
}

// Partial success, no rollback — unlike bulk-create (not implemented in this
// UI), a bulk delete can fail per-row; the caller must reconcile
// `deleted` vs `failed` itself rather than treat this as all-or-nothing.
export function useBulkDeleteCollectionDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug, documentIds }: { contentTypeSlug: string; documentIds: string[] }) =>
      api.delete<BulkDeleteResponse>(`/documents/collection-type/${contentTypeSlug}/bulk`, { data: { documentIds } }).then((response) => response.data),
    onSuccess: (result, { contentTypeSlug }) => {
      queryClient.invalidateQueries({ queryKey: KEYS.list(contentTypeSlug) });
      if (result.failed.length === 0) {
        toast.success(`Deleted ${result.deleted.length} document${result.deleted.length === 1 ? "" : "s"}`);
      } else {
        toast.error(`Deleted ${result.deleted.length} document${result.deleted.length === 1 ? "" : "s"}, ${result.failed.length} failed`);
      }
    },
    onError: onMutationError,
  });
}

export function useDuplicateCollectionDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug, id }: { contentTypeSlug: string; id: string }) =>
      api.post<Document>(`/documents/collection-type/${contentTypeSlug}/${id}/duplicate`).then((response) => response.data),
    onSuccess: (_, { contentTypeSlug }) => queryClient.invalidateQueries({ queryKey: KEYS.list(contentTypeSlug) }),
    onError: onMutationError,
  });
}

export function usePublishCollectionDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug, id }: { contentTypeSlug: string; id: string }) =>
      api.post<{ status: string }>(`/documents/collection-type/${contentTypeSlug}/${id}/publish`).then((response) => response.data),
    onSuccess: (_, { contentTypeSlug, id }) => {
      queryClient.invalidateQueries({ queryKey: KEYS.detail(contentTypeSlug, id) });
      queryClient.invalidateQueries({ queryKey: KEYS.list(contentTypeSlug) });
      toast.success("Published");
    },
    onError: onMutationError,
  });
}

export function useUnpublishCollectionDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contentTypeSlug, id }: { contentTypeSlug: string; id: string }) =>
      api.post<{ status: string }>(`/documents/collection-type/${contentTypeSlug}/${id}/unpublish`).then((response) => response.data),
    onSuccess: (_, { contentTypeSlug, id }) => {
      queryClient.invalidateQueries({ queryKey: KEYS.detail(contentTypeSlug, id) });
      queryClient.invalidateQueries({ queryKey: KEYS.list(contentTypeSlug) });
      toast.success("Unpublished");
    },
    onError: onMutationError,
  });
}
