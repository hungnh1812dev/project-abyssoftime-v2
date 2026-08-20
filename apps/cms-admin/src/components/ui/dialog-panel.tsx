"use client";

import { TriangleAlert } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DialogPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  note?: React.ReactNode;
  showCloseButton?: boolean;
  contentClassName?: string;
  children?: React.ReactNode;
}

function DialogPanel({ open, onOpenChange, title, description, note, showCloseButton, contentClassName, children }: DialogPanelProps) {
  const descriptionId = React.useId();
  const noteId = React.useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={showCloseButton} className={contentClassName} aria-describedby={note ? `${descriptionId} ${noteId}` : descriptionId}>
        <DialogHeader className="-mx-4 -mt-4 rounded-t-xl border-b p-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id={descriptionId}>{description}</DialogDescription>
        </DialogHeader>
        {note && (
          <div data-slot="dialog-note" id={noteId} className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>{note}</div>
          </div>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}

export { DialogPanel };
export type { DialogPanelProps };
