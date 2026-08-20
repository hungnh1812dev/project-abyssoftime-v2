import type { ReactNode } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogNote, DialogTitle } from "@/components/ui/dialog";

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {note && <DialogNote>{note}</DialogNote>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant={variant} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
