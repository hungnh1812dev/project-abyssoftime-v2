import type { ReactNode } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { DialogPanel } from "@/components/ui/dialog-panel";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  note?: ReactNode;
  confirmLabel?: string;
  variant?: ButtonProps["variant"];
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, onOpenChange, title, description, note, confirmLabel = "Confirm", variant = "destructive", loading, onConfirm }: ConfirmDialogProps) {
  return (
    <DialogPanel open={open} onOpenChange={onOpenChange} title={title} description={description} note={note} showCloseButton={false}>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button variant={variant} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}
