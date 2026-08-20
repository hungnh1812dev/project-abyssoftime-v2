"use client";

import { TriangleAlert, XIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HTMLParser } from "@/lib/html-parser";
import { cn } from "@/lib/utils";

const HEADER_VARIANT_CLASSES = {
  primary: "bg-primary text-primary-foreground",
  destructive: "bg-destructive text-destructive-foreground",
} as const;

type DialogPanelVariant = keyof typeof HEADER_VARIANT_CLASSES;

interface DialogPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  note?: React.ReactNode;
  variant?: DialogPanelVariant;
  showCloseButton?: boolean;
  contentClassName?: string;
  children?: React.ReactNode;
}

function renderDescription(description: React.ReactNode) {
  if (typeof description !== "string") return description;
  return <HTMLParser component="span" content={description} />;
}

function DialogPanel({ open, onOpenChange, title, description, note, variant = "primary", showCloseButton = true, contentClassName, children }: DialogPanelProps) {
  const descriptionId = React.useId();
  const noteId = React.useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={contentClassName} aria-describedby={note ? `${descriptionId} ${noteId}` : descriptionId}>
        <DialogHeader className={cn("-mx-4 -mt-4 h-9 flex-row items-center justify-between gap-4 rounded-t-xl px-4", HEADER_VARIANT_CLASSES[variant])}>
          <DialogTitle>{title}</DialogTitle>
          {showCloseButton && (
            <DialogClose data-slot="dialog-close" render={<Button variant="ghost" size="icon-sm" className="text-current hover:bg-white/15 hover:text-current" />}>
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogClose>
          )}
        </DialogHeader>
        <DialogDescription id={descriptionId} className="[&_mark]:bg-warning/30 [&_mark]:text-foreground [&_mark]:rounded [&_mark]:px-0.5 [&_strong]:text-foreground [&_strong]:font-semibold">
          {renderDescription(description)}
        </DialogDescription>
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
