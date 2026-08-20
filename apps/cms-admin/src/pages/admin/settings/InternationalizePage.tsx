import { Pencil, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { DialogPanel } from "@/components/ui/dialog-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocales } from "@/hooks/useLocales";
import { useCreateLocale, useDeleteLocale, useUpdateLocale } from "@/hooks/useLocalesMutations";
import type { Locale } from "@/types/cms";

export function InternationalizePage() {
  const { data: locales = [], isLoading } = useLocales();
  const createLocale = useCreateLocale();
  const updateLocale = useUpdateLocale();
  const deleteLocale = useDeleteLocale();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocale, setEditingLocale] = useState<Locale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Locale | null>(null);

  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formIsDefault, setFormIsDefault] = useState(false);

  function openCreateDialog() {
    setEditingLocale(null);
    setFormCode("");
    setFormName("");
    setFormIsDefault(false);
    setDialogOpen(true);
  }

  function openEditDialog(locale: Locale) {
    setEditingLocale(locale);
    setFormCode(locale.code);
    setFormName(locale.name);
    setFormIsDefault(locale.isDefault);
    setDialogOpen(true);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (editingLocale) {
      updateLocale.mutate({ code: editingLocale.code, name: formName, isDefault: formIsDefault }, { onSuccess: () => setDialogOpen(false) });
    } else {
      createLocale.mutate({ code: formCode, name: formName, isDefault: formIsDefault }, { onSuccess: () => setDialogOpen(false) });
    }
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteLocale.mutate(deleteTarget.code, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  if (isLoading) {
    return <p className="text-muted-foreground p-6">Loading…</p>;
  }

  const isSaving = createLocale.isPending || updateLocale.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Internationalize</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage the locales for your content.</p>
        </div>
        <Button onClick={openCreateDialog}>Add locale</Button>
      </div>

      <DialogPanel
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editingLocale ? "Edit locale" : "Add locale"}
        description={editingLocale ? "Update this locale's name and default status." : "Add a new locale for your content."}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="locale-code">Code</Label>
            <Input
              id="locale-code"
              value={formCode}
              onChange={(event) => setFormCode(event.target.value)}
              placeholder="en"
              disabled={!!editingLocale}
              required
              pattern="[a-z]+(-[a-z]+)*"
              minLength={2}
              maxLength={5}
            />
            <p className="text-muted-foreground text-xs">Lowercase, 2-5 characters (e.g., en, vi, zh-cn)</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="locale-name">Name</Label>
            <Input id="locale-name" value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="English" required maxLength={100} />
          </div>
          <div className="flex items-center gap-2">
            <input id="locale-default" type="checkbox" checked={formIsDefault} onChange={(event) => setFormIsDefault(event.target.checked)} className="border-input rounded" />
            <Label htmlFor="locale-default">Set as default locale</Label>
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : editingLocale ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete locale"
        description={
          deleteTarget && (
            <>
              Are you sure you want to delete the locale &quot;{deleteTarget.name}&quot; ({deleteTarget.code})?
            </>
          )
        }
        note="This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteLocale.isPending}
        onConfirm={handleDelete}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-24 text-center">Default</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {locales.map((locale) => (
            <TableRow key={locale.code}>
              <TableCell className="font-mono text-sm">{locale.code}</TableCell>
              <TableCell>{locale.name}</TableCell>
              <TableCell className="text-center">{locale.isDefault && <Star className="inline h-4 w-4 fill-amber-500 text-amber-500" />}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="outline" size="icon-xs" aria-label="Edit" onClick={() => openEditDialog(locale)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="destructive" size="icon-xs" aria-label="Delete" disabled={locales.length <= 1} onClick={() => setDeleteTarget(locale)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
