import { useState } from "react";

import { groupByResource } from "@/components/permissions/permissionGrouping";
import { PermissionTooltip } from "@/components/permissions/PermissionTooltip";
import { PermissionTree } from "@/components/permissions/PermissionTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { DialogPanel } from "@/components/ui/dialog-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type PermissionItem, usePermissions } from "@/hooks/usePermissions";
import { type RoleItem, useCreateRole, useDeleteRole, useRoleList, useUpdateRole } from "@/hooks/useRoles";

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleItem | null;
  permissions: PermissionItem[];
}

function RoleDialog({ open, onOpenChange, role, permissions }: RoleDialogProps) {
  const isEdit = role !== null;
  const [name, setName] = useState(role?.name ?? "");
  const [slug, setSlug] = useState(role?.slug ?? "");
  const [level, setLevel] = useState(role?.level ?? 50);
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const fieldsDisabled = role?.isDefault ?? false;
  const saving = createRole.isPending || updateRole.isPending;

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
  }

  function handleSave() {
    if (isEdit && role) {
      const input: { name?: string; permissions?: string[]; level?: number } = { permissions: selected };
      if (!fieldsDisabled) {
        input.name = name;
        input.level = level;
      }
      updateRole.mutate({ documentId: role.documentId, data: input }, { onSuccess: () => onOpenChange(false) });
    } else {
      createRole.mutate({ name, slug, permissions: selected, level }, { onSuccess: () => onOpenChange(false) });
    }
  }

  return (
    <DialogPanel
      open={open}
      onOpenChange={handleOpenChange}
      contentClassName="max-h-[85vh] overflow-y-auto"
      title={isEdit ? `Edit Role: ${role.name}` : "Create Role"}
      description={isEdit ? "Update this role's name, level, and permissions." : "Define a new role and its permission set."}
      note={fieldsDisabled && "This is a default role — name and level are locked, but permissions can still be edited."}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={name} onChange={(event) => setName(event.target.value)} disabled={fieldsDisabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-slug">Slug</Label>
            <Input id="role-slug" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={isEdit} placeholder="e.g. content-manager" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="role-level">Level (0-100)</Label>
          <Input id="role-level" type="number" min={0} max={100} value={level} onChange={(event) => setLevel(Number(event.target.value))} disabled={fieldsDisabled} />
        </div>
        <div className="space-y-1">
          <Label>Permissions</Label>
          <PermissionTree permissions={permissions} selected={selected} onChange={setSelected} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || !name || (!isEdit && !slug)}>
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Role"}
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}

function PermissionSubTree({ slugs, permissions }: { slugs: string[]; permissions: PermissionItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const bySlug = new Map(permissions.map((p) => [p.slug, p]));
  const groups = groupByResource(slugs.map((s) => bySlug.get(s)).filter((p): p is PermissionItem => Boolean(p)));

  if (slugs.length === 0) {
    return <span className="text-muted-foreground text-xs">No permissions</span>;
  }

  return (
    <div>
      <button type="button" onClick={() => setExpanded((value) => !value)} className="text-xs underline">
        {expanded ? "Hide" : "Show"} {slugs.length} permission{slugs.length !== 1 ? "s" : ""}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {groups.map(([resource, perms]) => (
            <div key={resource} className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground text-xs font-medium capitalize">{resource.replace(/_/g, " ")}:</span>
              {perms.map((p) => (
                <Badge key={p.slug} variant="secondary" className="text-xs">
                  {p.name}
                </Badge>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RolesPage() {
  const { data: roles, isLoading: rolesLoading, isError: rolesError } = useRoleList();
  const { data: permissions, isLoading: permissionsLoading } = usePermissions();
  const deleteRole = useDeleteRole();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleItem | null>(null);

  function openCreate() {
    setEditingRole(null);
    setDialogOpen(true);
  }

  function openEdit(role: RoleItem) {
    setEditingRole(role);
    setDialogOpen(true);
  }

  const isLoading = rolesLoading || permissionsLoading;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Roles & Permissions</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage roles and the permissions assigned to each.</p>
        </div>
        <PermissionTooltip required="role:manager">
          <Button size="sm" onClick={openCreate}>
            Create Role
          </Button>
        </PermissionTooltip>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rolesError ? (
        <p className="text-destructive">Failed to load roles.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(roles ?? []).map((role) => (
              <TableRow key={role.documentId}>
                <TableCell className="font-medium">
                  <Badge variant="secondary">{role.name}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{role.slug}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{role.level}</TableCell>
                <TableCell>
                  <PermissionSubTree slugs={role.permissions} permissions={permissions ?? []} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <PermissionTooltip required="role:manager">
                      <Button variant="outline" size="sm" onClick={() => openEdit(role)}>
                        Edit
                      </Button>
                    </PermissionTooltip>
                    {!role.isDefault && (
                      <PermissionTooltip required="role:manager">
                        <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(role)}>
                          Delete
                        </Button>
                      </PermissionTooltip>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <RoleDialog key={editingRole?.documentId ?? "create"} open={dialogOpen} onOpenChange={setDialogOpen} role={editingRole} permissions={permissions ?? []} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete role"
        description={deleteTarget && `Delete role "${deleteTarget.name}"?`}
        note="This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteRole.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteRole.mutate(deleteTarget.documentId, { onSuccess: () => setDeleteTarget(null) });
        }}
      />
    </div>
  );
}
