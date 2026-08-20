import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { DialogPanel } from "@/components/ui/dialog-panel";

interface DeleteConfirmDialogProps {
  open: boolean;
  bulkCount: number | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({ open, bulkCount, onOpenChange, onConfirm }: DeleteConfirmDialogProps) {
  const isBulk = bulkCount !== null;
  return (
    <DialogPanel
      open={open}
      onOpenChange={onOpenChange}
      variant="destructive"
      showCloseButton={false}
      title={isBulk ? `Delete ${bulkCount} entries` : "Delete entry"}
      description={isBulk ? `Are you sure you want to delete ${bulkCount} selected entries?` : "Are you sure you want to delete this entry?"}
      note="This action cannot be undone.">
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button variant="destructive" onClick={onConfirm}>
          Delete
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}
