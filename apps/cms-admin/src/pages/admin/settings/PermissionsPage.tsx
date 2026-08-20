import type { AxiosError } from "axios";
import { useState } from "react";

import { PermissionTooltip } from "@/components/permissions/PermissionTooltip";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DialogFooter } from "@/components/ui/dialog";
import { DialogPanel } from "@/components/ui/dialog-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type PermissionItem, useCreatePermission, useDeletePermission, usePermissions, useUpdatePermission } from "@/hooks/usePermissions";
import { apiErrorMessage } from "@/lib/errors";

const SLUG_PATTERN = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

interface DeleteConflictData {
  message?: string;
  roleCount?: number;
  accessTokenCount?: number;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as AxiosError<DeleteConflictData>).response?.data;
  if (data && (data.roleCount !== undefined || data.accessTokenCount !== undefined)) {
    return `Still referenced by ${data.roleCount ?? 0} role(s) and ${data.accessTokenCount ?? 0} access token(s) — remove those references first.`;
  }
  return apiErrorMessage(error, "Failed to delete permission");
}

interface PermissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permission: PermissionItem | null;
}

function PermissionDialog({ open, onOpenChange, permission }: PermissionDialogProps) {
  const isEdit = permission !== null;
  const [slug, setSlug] = useState(permission?.slug ?? "");
  const [name, setName] = useState(permission?.name ?? "");
  const [description, setDescription] = useState(permission?.description ?? "");
  const createPermission = useCreatePermission();
  const updatePermission = useUpdatePermission();

  const slugValid = slug === "" || SLUG_PATTERN.test(slug);
  const saving = createPermission.isPending || updatePermission.isPending;

  function handleSave() {
    if (isEdit && permission) {
      updatePermission.mutate({ documentId: permission.documentId, data: { name, description } }, { onSuccess: () => onOpenChange(false) });
      return;
    }
    if (!slug || !name || !SLUG_PATTERN.test(slug)) return;
    createPermission.mutate({ slug, name, description }, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <DialogPanel
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? `Edit Permission: ${permission.slug}` : "Create Permission"}
      description={isEdit ? "Update this permission's name and description." : "Define a new permission slug in the format resource:action."}
      note={
        !isEdit &&
        "Creating a permission here does not grant any new capability by itself — a developer must add a matching check in the backend code before this permission has any effect."
      }>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="permission-slug">Slug</Label>
          <Input id="permission-slug" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={isEdit} placeholder="e.g. reports:generate" />
          {!slugValid && <p className="text-destructive text-xs">Slug must match resource:action format (lowercase, e.g. "document:read")</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="permission-name">Name</Label>
          <Input id="permission-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="permission-description">Description</Label>
          <Input id="permission-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || !name || (!isEdit && (!slug || !slugValid))}>
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Permission"}
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}

export function PermissionsPage() {
  const { data: permissions, isLoading, isError } = usePermissions();
  const deletePermission = useDeletePermission();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPermission, setEditingPermission] = useState<PermissionItem | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PermissionItem | null>(null);

  function openCreate() {
    setEditingPermission(null);
    setDialogOpen(true);
  }

  function openEdit(permission: PermissionItem) {
    setEditingPermission(permission);
    setDialogOpen(true);
  }

  function handleDelete(permission: PermissionItem) {
    setDeleteErrors((prev) => ({ ...prev, [permission.slug]: "" }));
    deletePermission.mutate(permission.documentId, {
      onError: (error: unknown) => {
        setDeleteErrors((prev) => ({ ...prev, [permission.slug]: extractErrorMessage(error) }));
      },
    });
  }

  const sorted = [...(permissions ?? [])].sort((a, b) => a.slug.localeCompare(b.slug));
  const query = search.trim().toLowerCase();
  const filtered = query ? sorted.filter((permission) => `${permission.slug} ${permission.name} ${permission.description}`.toLowerCase().includes(query)) : sorted;

  // Slug/Description styling is body-only, so it's applied inside `cell` rather than via
  // `className` (see DataTableColumn.className's doc comment).
  const columns: DataTableColumn<PermissionItem>[] = [
    { key: "slug", header: "Slug", cell: (permission) => <span className="font-mono text-sm">{permission.slug}</span> },
    { key: "name", header: "Name", accessorKey: "name" },
    { key: "description", header: "Description", cell: (permission) => <span className="text-muted-foreground text-sm">{permission.description}</span> },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      cell: (permission) => (
        <div className="flex flex-col items-end gap-1">
          <div className="flex justify-end gap-2">
            <PermissionTooltip required="permission:manager">
              <Button variant="outline" size="sm" onClick={() => openEdit(permission)}>
                Edit
              </Button>
            </PermissionTooltip>
            <PermissionTooltip required="permission:manager">
              <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(permission)}>
                Delete
              </Button>
            </PermissionTooltip>
          </div>
          {deleteErrors[permission.slug] && <p className="text-destructive text-xs">{deleteErrors[permission.slug]}</p>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Permissions</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage the permission catalog. Roles select which of these to grant.</p>
        </div>
        <PermissionTooltip required="permission:manager">
          <Button size="sm" onClick={openCreate}>
            Create Permission
          </Button>
        </PermissionTooltip>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-destructive">Failed to load permissions.</p>
      ) : (
        <>
          <Input
            id="permission-search"
            name="permission-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by slug, name, or description…"
            aria-label="Search permissions"
            className="max-w-sm"
          />
          <DataTable columns={columns} data={filtered} getRowKey={(permission) => permission.documentId} />

          <p className="text-muted-foreground text-sm">
            {filtered.length === sorted.length ? `${sorted.length} permission${sorted.length !== 1 ? "s" : ""}` : `${filtered.length} of ${sorted.length} permissions`}
          </p>
        </>
      )}

      <PermissionDialog key={editingPermission?.documentId ?? "create"} open={dialogOpen} onOpenChange={setDialogOpen} permission={editingPermission} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete permission"
        description={deleteTarget && `Delete permission "${deleteTarget.slug}"?`}
        note="This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        loading={deletePermission.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
