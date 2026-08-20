import { useState } from "react";

import { PermissionTooltip } from "@/components/permissions/PermissionTooltip";
import { PermissionTree } from "@/components/permissions/PermissionTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DialogPanel } from "@/components/ui/dialog-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type AccessTokenItem, type ExpiresIn, useAccessTokenList, useCreateAccessToken, useDeleteAccessToken, useRevokeAccessToken } from "@/hooks/useAccessTokens";
import { usePermissions } from "@/hooks/usePermissions";

const EXPIRY_OPTIONS: Array<{ label: string; value: ExpiresIn }> = [
  { label: "30 minutes", value: "30m" },
  { label: "1 hour", value: "1h" },
  { label: "1 day", value: "1d" },
  { label: "1 month", value: "1m" },
  { label: "1 year", value: "1y" },
  { label: "Never", value: "never" },
];

// Passed as Select's `items` prop so the trigger can resolve the selected
// item's label even after the popup (and its mounted SelectItems) unmounts —
// without it, base-ui falls back to displaying the raw value (e.g. "1h").
const EXPIRY_ITEMS = Object.fromEntries(EXPIRY_OPTIONS.map((option) => [option.value, option.label]));

function TokenRevealDialog({ open, onOpenChange, token }: { open: boolean; onOpenChange: (open: boolean) => void; token: string | null }) {
  function copyToken() {
    if (token) navigator.clipboard.writeText(token);
  }

  return (
    <DialogPanel
      open={open}
      onOpenChange={onOpenChange}
      title="Token"
      description="Your new access token has been generated."
      note="Copy this token now. It will not be shown again.">
      <div className="space-y-3">
        <div className="bg-muted rounded-md border p-3">
          <code className="text-xs break-all">{token}</code>
        </div>
        <Button size="sm" onClick={copyToken} className="w-full">
          Copy Token
        </Button>
      </div>
    </DialogPanel>
  );
}

export function AccessTokensPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [expiresIn, setExpiresIn] = useState<ExpiresIn>("never");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccessTokenItem | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AccessTokenItem | null>(null);

  const { data: tokens = [], isLoading } = useAccessTokenList();
  const { data: permissions = [] } = usePermissions();
  const createToken = useCreateAccessToken();
  const revokeToken = useRevokeAccessToken();
  const deleteToken = useDeleteAccessToken();

  const permissionNameBySlug = new Map(permissions.map((permission) => [permission.slug, permission.name]));

  // Name/Expires styling is body-only, so it's applied inside `cell` rather than via
  // `className` (see DataTableColumn.className's doc comment).
  const columns: DataTableColumn<AccessTokenItem>[] = [
    { key: "name", header: "Name", cell: (token) => <span className="font-medium">{token.name}</span> },
    {
      key: "permissions",
      header: "Permissions",
      cell: (token) =>
        token.permissions.length === 0 ? (
          <span className="text-muted-foreground text-xs">No permissions</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {token.permissions.map((slug) => (
              <Badge key={slug} variant="secondary" className="text-xs">
                {permissionNameBySlug.get(slug) ?? slug}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: "expires",
      header: "Expires",
      cell: (token) => <span className="text-muted-foreground text-sm">{token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : "Never"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      cell: (token) => (
        <div className="flex justify-end gap-2">
          <PermissionTooltip required="api_token:manager">
            <Button variant="outline" size="sm" onClick={() => setRevokeTarget(token)}>
              Revoke
            </Button>
          </PermissionTooltip>
          <PermissionTooltip required="api_token:manager">
            <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(token)}>
              Delete
            </Button>
          </PermissionTooltip>
        </div>
      ),
    },
  ];

  function resetCreateForm() {
    setTokenName("");
    setSelectedPermissions([]);
    setExpiresIn("never");
  }

  function handleCreate() {
    if (!tokenName) return;
    createToken.mutate(
      { name: tokenName, permissions: selectedPermissions, expiresIn },
      {
        onSuccess: (response) => {
          setCreateOpen(false);
          resetCreateForm();
          setRevealedToken(response.token);
        },
      },
    );
  }

  function handleRevoke() {
    if (!revokeTarget) return;
    revokeToken.mutate(
      { id: revokeTarget.documentId },
      {
        onSuccess: (response) => {
          setRevokeTarget(null);
          setRevealedToken(response.token);
        },
      },
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Access Tokens</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          Create new token
        </Button>
        <DialogPanel
          open={createOpen}
          onOpenChange={(open: boolean) => {
            setCreateOpen(open);
            if (!open) resetCreateForm();
          }}
          contentClassName="max-h-[85vh] overflow-y-auto"
          title="Create Access Token"
          description="Generate a scoped API token for external integrations.">
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="token-name">Name</Label>
              <Input id="token-name" value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="e.g. Frontend production" />
            </div>
            <div className="space-y-1">
              <Label>Permissions</Label>
              <p className="text-muted-foreground text-xs">Leave empty for a token with no scoped permissions.</p>
              <PermissionTree permissions={permissions} selected={selectedPermissions} onChange={setSelectedPermissions} />
            </div>
            <div className="space-y-1">
              <Label>Expiration</Label>
              <Select items={EXPIRY_ITEMS} value={expiresIn} onValueChange={(value: string | null) => setExpiresIn((value as ExpiresIn) ?? "never")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select expiration" />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={createToken.isPending || !tokenName}>
              {createToken.isPending ? "Creating…" : "Create Token"}
            </Button>
          </div>
        </DialogPanel>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading…</p> : <DataTable columns={columns} data={tokens} getRowKey={(token) => token.documentId} />}

      <p className="text-muted-foreground text-sm">
        {tokens.length} token{tokens.length !== 1 ? "s" : ""}
      </p>

      <TokenRevealDialog open={revealedToken !== null} onOpenChange={(open) => !open && setRevealedToken(null)} token={revealedToken} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete token"
        description={deleteTarget && `Delete token "${deleteTarget.name}"?`}
        note="This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteToken.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteToken.mutate(deleteTarget.documentId, { onSuccess: () => setDeleteTarget(null) });
        }}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke token"
        description={revokeTarget && `Revoke and rotate the secret for "${revokeTarget.name}"?`}
        note="The current token will stop working immediately."
        confirmLabel="Revoke"
        variant="destructive"
        loading={revokeToken.isPending}
        onConfirm={handleRevoke}
      />
    </div>
  );
}
