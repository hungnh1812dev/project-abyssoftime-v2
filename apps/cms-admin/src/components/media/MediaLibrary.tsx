import { Trash2 } from "lucide-react";
import { useState } from "react";

import { PermissionTooltip } from "@/components/permissions/PermissionTooltip";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDeleteMedia, useMediaList, useUploadMedia } from "@/hooks/useMedia";
import { displayFileName } from "@/lib/media";
import type { MediaAsset } from "@/types/cms";

interface MediaLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (asset: MediaAsset) => void;
}

export function MediaLibrary({ isOpen, onClose, onSelect }: MediaLibraryProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);

  const { data: items = [], isLoading } = useMediaList();
  const upload = useUploadMedia();
  const deleteMedia = useDeleteMedia();

  if (!isOpen) return null;

  async function handleUpload() {
    for (const file of stagedFiles) {
      await upload.mutateAsync({ file });
    }
    setStagedFiles([]);
    setShowUpload(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <div className="bg-background flex max-h-[80vh] w-3xl flex-col overflow-hidden rounded-lg shadow-lg">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-semibold">Media Library</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowUpload(!showUpload)}>
              Upload More
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {showUpload && (
          <div className="space-y-3 border-b p-4">
            <label className="border-muted-foreground/30 bg-muted/30 text-foreground/70 hover:border-primary/50 hover:bg-muted/50 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm font-medium transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
              {stagedFiles.length > 0 ? `${stagedFiles.length} file${stagedFiles.length !== 1 ? "s" : ""} selected` : "Choose files to upload"}
              <input type="file" multiple accept="image/png,image/jpeg" onChange={(event) => setStagedFiles(Array.from(event.target.files ?? []))} className="sr-only" />
            </label>
            {stagedFiles.length > 0 && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {stagedFiles.map((file, fileIndex) => (
                    <div key={fileIndex} className="bg-muted relative aspect-square overflow-hidden rounded-lg border">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="h-full w-full object-cover"
                        onLoad={(event) => URL.revokeObjectURL((event.target as HTMLImageElement).src)}
                      />
                      <button
                        type="button"
                        className="bg-background/80 text-muted-foreground hover:text-destructive absolute top-1 right-1 rounded-full p-0.5 transition-colors"
                        onClick={() => setStagedFiles((prevFiles) => prevFiles.filter((_, itemIndex) => itemIndex !== fileIndex))}>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round">
                          <line x1="18" x2="6" y1="6" y2="18" />
                          <line x1="6" x2="18" y1="6" y2="18" />
                        </svg>
                      </button>
                      <span className="absolute right-0 bottom-0 left-0 truncate bg-black/50 px-1 py-0.5 text-[10px] text-white">{file.name}</span>
                    </div>
                  ))}
                </div>
                <PermissionTooltip required="media:manager">
                  <Button size="sm" className="w-full" onClick={handleUpload} disabled={upload.isPending}>
                    {upload.isPending ? "Uploading…" : `Upload ${stagedFiles.length} file${stagedFiles.length !== 1 ? "s" : ""}`}
                  </Button>
                </PermissionTooltip>
              </>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {items.map((asset) => (
                <div key={asset.documentId} className="group relative">
                  <button
                    type="button"
                    className="border-border hover:border-primary hover:ring-primary/20 relative aspect-square w-full overflow-hidden rounded-lg border-2 transition-all hover:shadow-md hover:ring-2"
                    disabled={deleteMedia.isPending}
                    onClick={() => {
                      onSelect(asset);
                      onClose();
                    }}>
                    <img src={asset.thumbnailUrl || asset.url} alt={displayFileName(asset)} className="h-full w-full object-contain" />
                    <span className="absolute right-0 bottom-0 left-0 truncate bg-black/60 px-1.5 py-0.5 text-center text-[10px] text-white">{displayFileName(asset)}</span>
                  </button>
                  <PermissionTooltip required="media:manager">
                    <button
                      type="button"
                      aria-label="Delete asset"
                      className="bg-background/80 text-muted-foreground absolute top-1 right-1 rounded p-0.5 opacity-0 transition-colors group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(asset);
                      }}>
                      <Trash2 size={14} />
                    </button>
                  </PermissionTooltip>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t p-4">
          <span className="text-muted-foreground text-sm">
            {items.length} asset{items.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete media"
        description={
          deleteTarget && (
            <>
              Are you sure you want to delete <strong>{deleteTarget.fileName}</strong>?
            </>
          )
        }
        note="This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMedia.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMedia.mutate(deleteTarget.documentId, {
            onSuccess: () => setDeleteTarget(null),
          });
        }}
      />
    </div>
  );
}
