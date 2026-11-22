import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  File as FileIcon, FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, FileSpreadsheet,
  Folder, X, CheckCircle2, AlertTriangle, FolderPlus, ChevronRight,
} from "lucide-react";
import { extOf } from "./brain";
import { useVault } from "./store";

export function KindIcon({ kind, name, size = 18 }: { kind: string; name?: string; size?: number }) {
  const e = name ? extOf(name) : "";
  const p = { size, strokeWidth: 1.7 };
  if (e === "csv" || e === "xls" || e === "xlsx") return <FileSpreadsheet {...p} className="text-emerald-400" />;
  switch (kind) {
    case "image": return <FileImage {...p} className="text-pink-400" />;
    case "video": return <FileVideo {...p} className="text-purple-400" />;
    case "audio": return <FileAudio {...p} className="text-amber-400" />;
    case "doc": return <FileText {...p} className="text-sky-400" />;
    case "text": return <FileText {...p} className="text-slate-400" />;
    case "code": return <FileCode {...p} className="text-teal-400" />;
    case "archive": return <FileArchive {...p} className="text-orange-400" />;
    default: return <FileIcon {...p} className="text-muted" />;
  }
}
export const FolderIcon = ({ size = 18, open }: { size?: number; open?: boolean }) => (
  <Folder size={size} strokeWidth={1.7} className="text-accent" fill={open ? "currentColor" : "none"} fillOpacity={0.2} />
);

export const Btn = ({ children, onClick, primary, danger, disabled, className = "", title }: {
  children: ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; className?: string; title?: string;
}) => (
  <button
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition ${
      primary
        ? "border-accent bg-accent text-accentfg hover:brightness-110"
        : danger
        ? "border-line bg-panel2 text-danger hover:border-danger"
        : "border-line bg-panel2 text-fg hover:border-accent"
    } ${className}`}
  >
    {children}
  </button>
);

export function ContextMenu() {
  const { menu, closeMenu } = useVault();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!menu) return;
    const r = ref.current?.getBoundingClientRect();
    const w = r?.width ?? 200, h = r?.height ?? 200;
    setPos({ x: Math.min(menu.x, window.innerWidth - w - 8), y: Math.min(menu.y, window.innerHeight - h - 8) });
    const close = () => closeMenu();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
    };
  }, [menu, closeMenu]);
  if (!menu) return null;
  return (
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.x, top: pos.y }}
      className="pop fixed z-50 min-w-48 rounded-lg border border-line bg-panel p-1 shadow-2xl shadow-black/40"
    >
      {menu.items.map((it, i) =>
        it.sep ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            onClick={() => { closeMenu(); it.onClick(); }}
            className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-panel2 ${it.danger ? "text-danger" : ""}`}
          >
            <span className="w-4 text-muted">{it.icon}</span>
            {it.label}
          </button>
        )
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="pop w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-fg"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputCls = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] text-fg placeholder:text-muted";

function FolderPicker({ folders, active, onPick }: { folders: string[]; active: string; onPick: (f: string) => void }) {
  return (
    <div className="max-h-56 overflow-auto rounded-md border border-line bg-bg p-1">
      {folders.map((f) => (
        <button
          key={f}
          onClick={() => onPick(f)}
          style={{ paddingLeft: 8 + f.split("/").length * 12 - 12 }}
          className={`flex w-full items-center gap-2 rounded py-1 pr-2 text-left ${active === f ? "bg-accent text-accentfg" : "hover:bg-panel2"}`}
        >
          <FolderIcon size={14} /> {f.split("/").pop()}
        </button>
      ))}
      {!folders.length && <div className="p-3 text-center text-muted">No folders yet — type a new path below.</div>}
    </div>
  );
}

export function Dialogs() {
  const { dialog, setDialog, folders, moveFiles, moveFolder, addFolder, db } = useVault();
  const [val, setVal] = useState("");
  const [sel, setSel] = useState("");
  useEffect(() => {
    if (dialog?.type === "prompt") setVal(dialog.value);
    if (dialog?.type === "move" || dialog?.type === "moveFolder") { setSel(""); setVal(""); }
  }, [dialog]);
  if (!dialog) return null;
  const close = () => setDialog(null);
  if (dialog.type === "prompt")
    return (
      <Modal title={dialog.title} onClose={close}>
        {dialog.label && <div className="mb-1.5 text-muted">{dialog.label}</div>}
        <input
          autoFocus value={val} onChange={(e) => setVal(e.target.value)} className={inputCls}
          onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) { close(); dialog.onOk(val); } }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={close}>Cancel</Btn>
          <Btn primary disabled={!val.trim()} onClick={() => { close(); dialog.onOk(val); }}>{dialog.ok}</Btn>
        </div>
      </Modal>
    );
  if (dialog.type === "confirm")
    return (
      <Modal title={dialog.title} onClose={close}>
        <p className="text-muted">{dialog.text}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={close}>Cancel</Btn>
          <Btn danger onClick={() => { close(); dialog.onOk(); }}>{dialog.ok}</Btn>
        </div>
      </Modal>
    );

  if (dialog.type === "moveFolder") {
    const source = dialog.name;
    const invalid = (f: string) => f === source || f.startsWith(source + "/");
    const target = val.trim() || sel;
    return (
      <Modal title={`Move folder "${source}"`} onClose={close}>
        <FolderPicker
          folders={folders.filter((f) => !invalid(f))}
          active={val ? "" : sel}
          onPick={(f) => { setSel(f); setVal(""); }}
        />
        <div className="mt-3 text-muted">…or type a new parent path</div>
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Work/Contracts" className={`${inputCls} mt-1.5`} />
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={close}>Cancel</Btn>
          <Btn primary disabled={!target || invalid(target)} onClick={() => { close(); if (val.trim()) addFolder(val); moveFolder(source, target); }}>
            <ChevronRight size={14} /> Move here
          </Btn>
        </div>
      </Modal>
    );
  }

  const target = val.trim() || sel;
  return (
    <Modal title={`Move ${dialog.ids.length > 1 ? dialog.ids.length + " files" : db.files.find((f) => f.id === dialog.ids[0])?.name ?? "file"}`} onClose={close}>
      <FolderPicker folders={folders} active={val ? "" : sel} onPick={(f) => { setSel(f); setVal(""); }} />
      <div className="mt-3 text-muted">…or type a new folder path</div>
      <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Work/Contracts" className={`${inputCls} mt-1.5`} />
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={close}>Cancel</Btn>
        <Btn primary disabled={!target} onClick={() => { close(); if (val.trim()) addFolder(val); moveFiles(dialog.ids, target); }}>
          <ChevronRight size={14} /> Move here
        </Btn>
      </div>
    </Modal>
  );
}

export function Toast() {
  const { toastMsg } = useVault();
  if (!toastMsg) return null;
  const err = toastMsg.kind === "err";
  return (
    <div className="pop pointer-events-none fixed bottom-12 left-1/2 z-[60] -translate-x-1/2">
      <div className={`flex max-w-xl items-start gap-2 rounded-lg border bg-panel px-4 py-2.5 shadow-2xl ${err ? "border-danger" : "border-ok"}`}>
        {err ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" />}
        <span>{toastMsg.msg}</span>
      </div>
    </div>
  );
}

export const NewFolderIcon = FolderPlus;
