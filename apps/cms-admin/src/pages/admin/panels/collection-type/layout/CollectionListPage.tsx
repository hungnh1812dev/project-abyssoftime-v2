import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ColumnChooserDialog } from "@/components/collection/ColumnChooserDialog";
import { PageSizeSelector } from "@/components/collection/PageSizeSelector";
import { CheckboxInput } from "@/components/form/inputs/CheckboxInput";
import { PermissionTooltip } from "@/components/permissions/PermissionTooltip";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type CollectionColumnDef, getRegistration } from "@/content-type-registry";
import { useBulkDeleteCollectionDocuments, useCollectionDocuments, useDeleteCollectionDocument, useDuplicateCollectionDocument } from "@/hooks/useCollectionDocuments";
import { useUpdateListFields } from "@/hooks/useContentTypes";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PAGE_SIZE_OPTIONS } from "@/lib/pageSize";
import { type ContentType, type FieldDefinition, type ListedDocumentItem } from "@/types/cms";

import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { RowActions } from "./RowActions";

interface Props {
  contentType: ContentType;
}

const SYSTEM_FIELD_KEYS = new Set(["id", "createdAt", "updatedAt", "updatedBy"]);

function deriveColumns(contentType: ContentType): CollectionColumnDef[] {
  const registration = getRegistration(contentType.slug);
  if (registration?.columns) return registration.columns;

  const listFieldNames = (contentType.listFields ?? []).filter((name) => !SYSTEM_FIELD_KEYS.has(name));
  const fields = contentType.fields ?? [];
  const fieldMap = new Map<string, FieldDefinition>();
  for (const field of fields) fieldMap.set(field.name, field);

  const names =
    listFieldNames.length > 0
      ? listFieldNames
      : fields
          .filter((field) => field.type !== "component")
          .slice(0, 3)
          .map((field) => field.name);

  return names.map((name) => {
    const field = fieldMap.get(name);
    const fieldType = field?.type ?? "text";
    let colType: CollectionColumnDef["type"] = "text";
    if (fieldType === "boolean") colType = "boolean";
    else if (fieldType === "number") colType = "number";
    else if (fieldType === "media") colType = "image";
    return { key: name, label: name, type: colType };
  });
}

function deriveSystemVisibility(listFields: string[]): { showId: boolean; showCreatedAt: boolean; showUpdatedAt: boolean; showUpdatedBy: boolean } {
  if (listFields.length === 0) {
    return { showId: true, showCreatedAt: true, showUpdatedAt: true, showUpdatedBy: true };
  }
  return {
    showId: listFields.includes("id"),
    showCreatedAt: listFields.includes("createdAt"),
    showUpdatedAt: listFields.includes("updatedAt"),
    showUpdatedBy: listFields.includes("updatedBy"),
  };
}

function cellValue(doc: ListedDocumentItem, col: CollectionColumnDef): React.ReactNode {
  const raw = doc.data[col.key];
  switch (col.type) {
    case "boolean":
      return raw ? "✓" : "—";
    case "number":
      return String(raw ?? "");
    case "image":
      return <img src={String(raw ?? "")} alt={col.label} className="h-8 w-8 rounded object-cover" />;
    default:
      return String(raw ?? "");
  }
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

type SortField = string;
type SortDir = "asc" | "desc";

// System-column orderBy values are snake_case at the wire level even though
// the same columns are camelCase in response bodies — see the note in
// useCollectionDocuments.ts. Content-type schema field names pass through
// as-is.
function getSortableFieldNames(contentType: ContentType): Set<string> {
  const names = new Set<string>(["id", "created_at", "updated_at"]);
  for (const field of contentType.fields ?? []) {
    if (field.type === "text" || field.type === "number" || field.type === "boolean") {
      names.add(field.name);
    }
  }
  return names;
}

const DEFAULT_PAGE_SIZE: number = PAGE_SIZE_OPTIONS[0];

function parseListState(params: URLSearchParams, sortableFields: Set<string>) {
  const rawOrderBy = params.get("orderBy") ?? "";
  const orderBy: SortField = sortableFields.has(rawOrderBy) ? rawOrderBy : "id";

  const sortDir: SortDir = params.get("sortDir") === "asc" ? "asc" : "desc";

  const rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = Number(params.get("pageSize"));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;

  const search = params.get("search") ?? "";

  return { orderBy, sortDir, page, pageSize, search };
}

type ListState = ReturnType<typeof parseListState>;

function toCanonicalParams(state: ListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.orderBy !== "id") params.set("orderBy", state.orderBy);
  if (state.sortDir !== "desc") params.set("sortDir", state.sortDir);
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(state.pageSize));
  if (state.search !== "") params.set("search", state.search);
  return params;
}

const SEARCH_DEBOUNCE_MS = 400;

function SortableHeader({
  label,
  field,
  activeField,
  activeDir,
  onSort,
}: {
  label: string;
  field: SortField;
  activeField: string;
  activeDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const isActive = activeField === field;
  const Icon = isActive ? (activeDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button type="button" className="hover:text-foreground flex items-center gap-1 font-medium" onClick={() => onSort(field)}>
      {label}
      <Icon className={`h-3.5 w-3.5 ${isActive ? "text-foreground" : "text-muted-foreground"}`} />
    </button>
  );
}

const statusVariant: Record<string, "draft" | "published" | "modified"> = {
  draft: "draft",
  published: "published",
  modified: "modified",
};

export function CollectionListPage({ contentType }: Props) {
  const [columnChooserOpen, setColumnChooserOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const sortableFields = getSortableFieldNames(contentType);
  const { orderBy, sortDir, page: currentPage, pageSize, search: activeSearch } = parseListState(searchParams, sortableFields);
  const start = (currentPage - 1) * pageSize;

  function updateListState(patch: Partial<ListState>) {
    const next = { orderBy, sortDir, page: currentPage, pageSize, search: activeSearch, ...patch };
    setSearchParams(toCanonicalParams(next), { replace: true });
  }

  useEffect(() => {
    const canonical = toCanonicalParams({ orderBy, sortDir, page: currentPage, pageSize, search: activeSearch });
    if (canonical.toString() !== searchParams.toString()) {
      setSearchParams(canonical, { replace: true });
    }
  }, [searchParams, orderBy, sortDir, currentPage, pageSize, activeSearch, setSearchParams]);

  // Local draft so keystrokes render immediately — the debounced value is what
  // actually gets written to the URL/query (documented exception to the
  // URL-sole-source-of-truth rule, rules/frontend-data.md §1.5). Resynced from
  // the committed URL value (whether from our own debounced write-back or an
  // external nav) directly in render, not an effect — this is React's
  // documented "adjusting state when a prop changes" pattern; it also covers
  // clearing row selection whenever the effective search actually changes.
  const [searchDraft, setSearchDraft] = useState(activeSearch);
  const [prevActiveSearch, setPrevActiveSearch] = useState(activeSearch);
  if (activeSearch !== prevActiveSearch) {
    setPrevActiveSearch(activeSearch);
    setSearchDraft(activeSearch);
    setSelectedIds(new Set());
  }
  const debouncedSearch = useDebouncedValue(searchDraft, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (debouncedSearch === activeSearch) return;
    const canonical = toCanonicalParams({ orderBy, sortDir, page: 1, pageSize, search: debouncedSearch });
    setSearchParams(canonical, { replace: true });
  }, [debouncedSearch, activeSearch, orderBy, sortDir, pageSize, setSearchParams]);

  const queryClient = useQueryClient();
  const { data: page, isLoading } = useCollectionDocuments(contentType.slug, start, pageSize, orderBy, sortDir, activeSearch);
  const { mutate: deleteDoc } = useDeleteCollectionDocument();
  const { mutate: bulkDeleteDocs } = useBulkDeleteCollectionDocuments();
  const { mutateAsync: duplicateDoc } = useDuplicateCollectionDocument();
  const updateListFields = useUpdateListFields();
  const navigate = useNavigate();

  const hasRegistryOverride = Boolean(getRegistration(contentType.slug)?.columns);
  const columns = deriveColumns(contentType);
  const hasSearchableColumn = columns.some((column) => column.type === "text");
  const systemVis = deriveSystemVisibility(contentType.listFields ?? []);
  const docs = page?.items ?? [];
  const total = page?.total ?? 0;

  function handleCreate() {
    navigate(`/admin/content-type/collection-type/${contentType.slug}/new`);
  }

  function handleDelete(event: React.MouseEvent, doc: ListedDocumentItem) {
    event.stopPropagation();
    setDeleteTarget(doc.documentId);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteDoc({ contentTypeSlug: contentType.slug, id: deleteTarget });
    setDeleteTarget(null);
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const doc of docs) {
        const documentId = doc.documentId;
        if (checked) next.add(documentId);
        else next.delete(documentId);
      }
      return next;
    });
  }

  function toggleSelectRow(documentId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  }

  function confirmBulkDelete() {
    bulkDeleteDocs({ contentTypeSlug: contentType.slug, documentIds: Array.from(selectedIds) }, { onSuccess: () => setSelectedIds(new Set()) });
    setBulkDeleteConfirmOpen(false);
  }

  function handleDuplicate(event: React.MouseEvent, doc: ListedDocumentItem) {
    event.stopPropagation();
    duplicateDoc({
      contentTypeSlug: contentType.slug,
      id: doc.documentId,
    }).then((newDoc) => {
      navigate(`/admin/content-type/collection-type/${contentType.slug}/${newDoc.data.documentId}`);
    });
  }

  function handleEdit(event: React.MouseEvent, doc: ListedDocumentItem) {
    event.stopPropagation();
    navigate(`/admin/content-type/collection-type/${contentType.slug}/${doc.documentId}`);
  }

  function handleSort(sortField: SortField) {
    const nextDir: SortDir = orderBy === sortField ? (sortDir === "desc" ? "asc" : "desc") : "desc";
    updateListState({ orderBy: sortField, sortDir: nextDir, page: 1 });
    setSelectedIds(new Set());
  }

  function handleRowClick(doc: ListedDocumentItem) {
    navigate(`/admin/content-type/collection-type/${contentType.slug}/${doc.documentId}`);
  }

  function handleSaveListFields(selectedFields: string[]) {
    updateListFields.mutate(
      { slug: contentType.slug, listFields: selectedFields },
      {
        onSuccess: () => {
          setColumnChooserOpen(false);
          queryClient.invalidateQueries({ queryKey: ["documents", "collection-type", contentType.slug] });
        },
      },
    );
  }

  if (isLoading) {
    return <p className="text-muted-foreground p-6">Loading…</p>;
  }

  const showingFrom = total === 0 ? 0 : start + 1;
  const showingTo = Math.min(start + pageSize, total);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex flex-col gap-0.5">
          <Breadcrumb items={[{ label: "Home", to: "/admin" }, { label: "Content Manager" }]} />
          <h1 className="text-xl font-semibold">{contentType.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasSearchableColumn && (
            <Input type="text" placeholder="Search…" aria-label="Search" className="h-7 w-48" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
          )}
          <PageSizeSelector
            value={pageSize}
            onChange={(size) => {
              updateListState({ pageSize: size, page: 1 });
              setSelectedIds(new Set());
            }}
          />
          {!hasRegistryOverride && (
            <Button variant="outline" size="icon" aria-label="Configure columns" onClick={() => setColumnChooserOpen(true)}>
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
          <PermissionTooltip required="create" contentTypeSlug={contentType.slug}>
            <Button onClick={handleCreate}>Add new item</Button>
          </PermissionTooltip>
        </div>
      </div>

      {!hasRegistryOverride && (
        <ColumnChooserDialog
          open={columnChooserOpen}
          onOpenChange={setColumnChooserOpen}
          contentType={contentType}
          currentListFields={contentType.listFields ?? []}
          onSave={handleSaveListFields}
          isSaving={updateListFields.isPending}
        />
      )}

      <DeleteConfirmDialog
        open={deleteTarget !== null || bulkDeleteConfirmOpen}
        bulkCount={bulkDeleteConfirmOpen ? selectedIds.size : null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setBulkDeleteConfirmOpen(false);
          }
        }}
        onConfirm={bulkDeleteConfirmOpen ? confirmBulkDelete : confirmDelete}
      />

      {selectedIds.size > 0 && (
        <div className="bg-muted/50 flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-sm">{selectedIds.size} selected</span>
          <PermissionTooltip required="delete" contentTypeSlug={contentType.slug}>
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteConfirmOpen(true)}>
              Delete selected ({selectedIds.size})
            </Button>
          </PermissionTooltip>
        </div>
      )}

      {docs.length === 0 ? (
        <p className="text-muted-foreground">No entries yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <CheckboxInput
                      aria-label="Select all"
                      checked={docs.length > 0 && docs.every((doc) => selectedIds.has(doc.documentId))}
                      onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                    />
                  </TableHead>
                  {systemVis.showId && (
                    <TableHead>
                      <SortableHeader label="ID" field="id" activeField={orderBy} activeDir={sortDir} onSort={handleSort} />
                    </TableHead>
                  )}
                  {columns.map((column) =>
                    sortableFields.has(column.key) ? (
                      <TableHead key={column.key}>
                        <SortableHeader label={column.label} field={column.key} activeField={orderBy} activeDir={sortDir} onSort={handleSort} />
                      </TableHead>
                    ) : (
                      <TableHead key={column.key}>{column.label}</TableHead>
                    ),
                  )}
                  {systemVis.showCreatedAt && (
                    <TableHead>
                      <SortableHeader label="Created At" field="created_at" activeField={orderBy} activeDir={sortDir} onSort={handleSort} />
                    </TableHead>
                  )}
                  {systemVis.showUpdatedAt && (
                    <TableHead>
                      <SortableHeader label="Updated At" field="updated_at" activeField={orderBy} activeDir={sortDir} onSort={handleSort} />
                    </TableHead>
                  )}
                  {systemVis.showUpdatedBy && <TableHead>Updated By</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.documentId} className="cursor-pointer" onClick={() => handleRowClick(doc)}>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <CheckboxInput
                        aria-label={`Select ${doc.documentId}`}
                        checked={selectedIds.has(doc.documentId)}
                        onCheckedChange={(checked) => toggleSelectRow(doc.documentId, checked === true)}
                      />
                    </TableCell>
                    {systemVis.showId && <TableCell className="text-muted-foreground text-sm">{doc.id}</TableCell>}
                    {columns.map((column) => (
                      <TableCell key={column.key}>{cellValue(doc, column)}</TableCell>
                    ))}
                    {systemVis.showCreatedAt && <TableCell className="text-muted-foreground text-sm">{formatDate(doc.createdAt)}</TableCell>}
                    {systemVis.showUpdatedAt && <TableCell className="text-muted-foreground text-sm">{formatDate(doc.updatedAt)}</TableCell>}
                    {systemVis.showUpdatedBy && <TableCell className="text-muted-foreground text-sm">{doc.updatedBy?.name ?? ""}</TableCell>}
                    <TableCell>
                      <Badge variant={statusVariant[doc.status] ?? "draft"}>{doc.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        contentTypeSlug={contentType.slug}
                        onEdit={(event) => handleEdit(event, doc)}
                        onDuplicate={(event) => handleDuplicate(event, doc)}
                        onDelete={(event) => handleDelete(event, doc)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="text-muted-foreground flex items-center justify-between text-sm">
            <span>
              Showing {showingFrom}–{showingTo} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={start === 0}
                onClick={() => {
                  updateListState({ page: Math.max(1, currentPage - 1) });
                  setSelectedIds(new Set());
                }}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={start + pageSize >= total}
                onClick={() => {
                  updateListState({ page: currentPage + 1 });
                  setSelectedIds(new Set());
                }}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
