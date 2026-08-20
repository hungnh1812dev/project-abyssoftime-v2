import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { type RoleItem, useRoleList } from "@/hooks/useRoles";
import { type UserItem, useDeleteUser, useUpdateUserRole, useUserList } from "@/hooks/useUsers";

export function UsersPage() {
  const { role: myRole, permissions, userId } = useAuth();

  const { data: users = [], isLoading } = useUserList();
  const { data: roles = [] } = useRoleList();
  const updateRole = useUpdateUserRole();
  const deleteUser = useDeleteUser();
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [roleChangeTarget, setRoleChangeTarget] = useState<{ user: UserItem; role: RoleItem } | null>(null);

  const roleById = new Map(roles.map((role) => [role.documentId, role]));
  const myLevel = myRole?.level ?? 0;
  // A role can only be assigned by (and to a row managed by) a caller whose
  // own role level is strictly higher — mirrors the server-side hierarchy
  // check on PATCH /users/:id/role, done here against live role data instead
  // of a hardcoded role list.
  const availableRoles = roles.filter((role) => role.level < myLevel);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isMe = user.documentId === userId;
              const userRole: RoleItem | undefined = user.roleId ? roleById.get(user.roleId) : undefined;
              const canManage = !isMe && myLevel > (userRole?.level ?? 0);
              // Level outranking mirrors the server's hierarchy check, but the
              // server also requires these permission slugs on top of it — a
              // caller can outrank a row by level and still lack the grant.
              const canChangeRole = canManage && permissions.includes("user:role_manager");
              const canDelete = canManage && permissions.includes("user:manager");
              return (
                <TableRow key={user.documentId} className={isMe ? "bg-accent/30" : undefined}>
                  <TableCell>
                    {user.email}
                    {isMe && <span className="text-muted-foreground ml-2 text-xs">(you)</span>}
                  </TableCell>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{userRole?.name ?? "No role"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {(canChangeRole || canDelete) && (
                      <div className="flex justify-end gap-2">
                        {canChangeRole && (
                          <Select
                            value={null}
                            onValueChange={(roleId: string | null) => {
                              const role = availableRoles.find((candidate) => candidate.documentId === roleId);
                              if (role) setRoleChangeTarget({ user, role });
                            }}>
                            <SelectTrigger className="h-8 w-32 text-xs">
                              <SelectValue placeholder="Change role" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableRoles.map((role) => (
                                <SelectItem key={role.documentId} value={role.documentId}>
                                  {role.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {canDelete && (
                          <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(user)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <p className="text-muted-foreground text-sm">
        {users.length} user{users.length !== 1 ? "s" : ""}
      </p>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete user"
        description={deleteTarget && `Are you sure you want to delete ${deleteTarget.email}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteUser.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteUser.mutate(deleteTarget.documentId, { onSuccess: () => setDeleteTarget(null) });
        }}
      />

      <ConfirmDialog
        open={roleChangeTarget !== null}
        onOpenChange={(open) => !open && setRoleChangeTarget(null)}
        title="Change role"
        description={roleChangeTarget && `Change ${roleChangeTarget.user.email}'s role to "${roleChangeTarget.role.name}"?`}
        confirmLabel="Change role"
        variant="default"
        loading={updateRole.isPending}
        onConfirm={() => {
          if (!roleChangeTarget) return;
          updateRole.mutate({ id: roleChangeTarget.user.documentId, roleId: roleChangeTarget.role.documentId }, { onSuccess: () => setRoleChangeTarget(null) });
        }}
      />
    </div>
  );
}
