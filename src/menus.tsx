import {
  Download, ExternalLink, FolderInput, FolderPlus, Pencil, Trash2, RefreshCw, Upload, FolderOpen,
  Eye, EyeOff, CheckSquare, CheckCheck, ListChecks,
} from "lucide-react";
import { useVault, type FileRec, type MenuItem } from "./store";

export function pickFiles(cb: (f: File[]) => void) {
  const i = document.createElement("input");
  i.type = "file"; i.multiple = true;
  i.onchange = () => { const f = [...(i.files ?? [])]; if (f.length) cb(f); };
  i.click();
}

interface BgMenuOptions {
  ids?: number[];
  showCheckboxes?: boolean;
  toggleCheckboxes?: () => void;
}

export function useMenus() {
  const v = useVault();
  const sz = 14;

  const uploadHere = (folder: string) => pickFiles((f) => v.upload(f, folder || "General", v.dest ?? null));
  const newSub = (parent: string) =>
    v.setDialog({
      type: "prompt", title: parent ? `New subfolder in ${parent}` : "New folder", label: "Folder name", value: "", ok: "Create",
      onOk: (n) => v.addFolder(parent ? `${parent}/${n}` : n),
    });

  const currentIds = () => (v.selected.length ? v.selected : v.selId != null ? [v.selId] : []);
  const targetsFor = (f: FileRec) => {
    const ids = currentIds();
    return ids.includes(f.id) ? ids : [f.id];
  };
  const removeDialog = (ids: number[]) => {
    const names = ids.map((id) => v.db.files.find((f) => f.id === id)?.name).filter(Boolean);
    const label = ids.length === 1 ? `"${names[0] ?? "file"}"` : `${ids.length} files`;
    v.setDialog({
      type: "confirm", title: "Remove file",
      text: `Remove ${label} from Vault's index? The Telegram messages are not deleted.`,
      ok: "Remove", onOk: () => ids.forEach((id) => v.removeFile(id)),
    });
  };

  const fileMenu = (f: FileRec): MenuItem[] => {
    const ids = targetsFor(f);
    const many = ids.length > 1;
    const count = many ? ` (${ids.length})` : "";
    return [
      { label: `Download${count}`, icon: <Download size={sz} />, onClick: () => ids.forEach((id) => v.download(id)) },
      { label: "Open in Telegram", icon: <ExternalLink size={sz} />, onClick: () => ids.forEach((id) => v.openLink(id)) },
      { sep: true, label: "", onClick: () => {} },
      { label: `Move to folder…${count}`, icon: <FolderInput size={sz} />, onClick: () => v.setDialog({ type: "move", ids }) },
      { label: "New subfolder here", icon: <FolderPlus size={sz} />, onClick: () => newSub(f.folder) },
      { label: f.hidden ? "Unhide" : "Hide", icon: f.hidden ? <Eye size={sz} /> : <EyeOff size={sz} />, onClick: () => v.setHidden(ids, !f.hidden) },
      { sep: true, label: "", onClick: () => {} },
      { label: `Delete${count}`, danger: true, icon: <Trash2 size={sz} />, onClick: () => removeDialog(ids) },
    ];
  };

  const folderMenu = (p: string): MenuItem[] => [
    { label: "Open", icon: <FolderOpen size={sz} />, onClick: () => v.go(p) },
    { label: "New subfolder", icon: <FolderPlus size={sz} />, onClick: () => newSub(p) },
    { label: "Rename", icon: <Pencil size={sz} />, onClick: () => v.setDialog({ type: "prompt", title: "Rename folder", label: "New path", value: p, ok: "Rename", onOk: (n) => v.renameFolder(p, n) }) },
    { label: "Move to folder…", icon: <FolderInput size={sz} />, onClick: () => v.setDialog({ type: "moveFolder", name: p }) },
    { label: "Upload here", icon: <Upload size={sz} />, onClick: () => uploadHere(p) },
    { sep: true, label: "", onClick: () => {} },
    {
      label: "Delete", danger: true, icon: <Trash2 size={sz} />,
      onClick: () => v.setDialog({ type: "confirm", title: "Delete folder", text: `Delete "${p}"? Its files move up one level.`, ok: "Delete", onOk: () => v.deleteFolder(p) }),
    },
  ];

  const bgMenu = (p: string, opts: BgMenuOptions = {}): MenuItem[] => {
    const ids = opts.ids ?? [];
    const invert = () => {
      const set = new Set(v.selected);
      const next = ids.filter((id) => !set.has(id));
      v.setSelection(next, next[next.length - 1] ?? null, v.anchorId);
    };
    return [
      { label: "Upload here", icon: <Upload size={sz} />, onClick: () => uploadHere(p) },
      { label: "New folder", icon: <FolderPlus size={sz} />, onClick: () => newSub(p) },
      { label: "Refresh", icon: <RefreshCw size={sz} />, onClick: v.refresh },
      { sep: true, label: "", onClick: () => {} },
      { label: "Select all files", icon: <CheckCheck size={sz} />, onClick: () => v.setSelection(ids, ids[ids.length - 1] ?? null, ids[0] ?? null) },
      { label: "Invert selection", icon: <ListChecks size={sz} />, onClick: invert },
      { label: opts.showCheckboxes ? "Hide item check boxes" : "Show item check boxes", icon: <CheckSquare size={sz} />, onClick: opts.toggleCheckboxes ?? (() => {}) },
    ];
  };

  return { fileMenu, folderMenu, bgMenu, uploadHere, newSub };
}
