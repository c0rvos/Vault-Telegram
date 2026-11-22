import { useState, type DragEvent } from "react";
import { useVault } from "./store";

export const FILE_MIME = "application/x-vault-file";
export const FOLDER_MIME = "application/x-vault-folder";

export function encodeDragIds(ids: number[]) {
  return ids.join(",");
}

export function useFolderDrop(path: string) {
  const { moveFiles, moveFolder, toast } = useVault();
  const [over, setOver] = useState(false);
  const props = {
    onDragOver: (e: DragEvent) => {
      const types = e.dataTransfer.types;
      if (types.includes(FILE_MIME) || types.includes(FOLDER_MIME)) {
        e.preventDefault(); e.stopPropagation(); setOver(true);
      }
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      setOver(false);
      const folder = e.dataTransfer.getData(FOLDER_MIME);
      const raw = e.dataTransfer.getData(FILE_MIME);
      if (!folder && !raw) return;
      e.preventDefault(); e.stopPropagation();
      if (folder) {
        moveFolder(folder, path);
        return;
      }
      const ids = raw.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
      if (!ids.length) return;
      if (!path) toast(ids.length > 1 ? "Drop onto a folder to move the files" : "Drop onto a folder to move the file", "err");
      else moveFiles(ids, path);
    },
  };
  return { over, props };
}
