import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, List, LayoutGrid, ArrowDownAZ, ArrowUpAZ, FolderPlus, Download, ExternalLink, FolderInput, Trash2, X, Loader2,
  Upload as UploadIcon, Bot, Layers, Radio, Calendar, HardDrive, Folder as FolderI, Link2,
  CheckSquare, CheckCheck, ListChecks, Eye, EyeOff,
} from "lucide-react";
import { fmtDate, fmtSize, useVault, type FileRec, type Preview } from "../store";
import { extOf } from "../brain";
import { FILE_MIME, FOLDER_MIME, encodeDragIds, useFolderDrop } from "../dnd";
import { Btn, FolderIcon, KindIcon, inputCls } from "../ui";
import { useMenus } from "../menus";

type Sort = "name" | "size" | "date" | "kind";

interface FileFilter {
  text: string[];
  ext?: string;
  type?: string;
  folder?: string;
  channel?: string;
  min?: number;
  max?: number;
  after?: number;
  before?: number;
  hidden?: boolean;
}

const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };

function parseSize(text: string) {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * (SIZE_UNITS[(m[2] || "b").toLowerCase()] || 1);
}

function parseDate(text: string) {
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : t;
}

function parseFilter(raw: string): FileFilter {
  const f: FileFilter = { text: [] };
  const tokens = raw.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((t) => t.replace(/^"|"$/g, "").toLowerCase()) ?? [];
  for (const token of tokens) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:\*\.|\.)([a-z0-9]+)$/.exec(token))) { f.ext = m[1]; continue; }
    if (token.startsWith("ext:")) { f.ext = token.slice(4).replace(/^\*\./, "").replace(/^\./, ""); continue; }
    if (token.startsWith("type:")) { f.type = token.slice(5); continue; }
    if (token.startsWith("folder:")) { f.folder = token.slice(7); continue; }
    if (token.startsWith("channel:")) { f.channel = token.slice(8); continue; }
    if (token.startsWith("size:")) {
      const value = token.slice(5);
      const op = /^[<>=]/.test(value) ? value[0] : "=";
      const n = parseSize(op === "=" ? value : value.slice(1));
      if (n != null) {
        if (op === "<") f.max = n - 1;
        else if (op === ">") f.min = n + 1;
        else { f.min = n; f.max = n; }
        continue;
      }
    }
    if (token.startsWith("modified:") || token.startsWith("date:")) {
      const value = token.slice(token.indexOf(":") + 1);
      const op = /^[<>=]/.test(value) ? value[0] : "=";
      const d = parseDate(op === "=" ? value : value.slice(1));
      if (d != null) {
        if (op === "<") f.before = d;
        else if (op === ">") f.after = d;
        else { f.after = d; f.before = d + 86_400_000; }
        continue;
      }
    }
    if (token.startsWith("after:")) { const d = parseDate(token.slice(6)); if (d != null) { f.after = d; continue; } }
    if (token.startsWith("before:")) { const d = parseDate(token.slice(7)); if (d != null) { f.before = d; continue; } }
    if (token === "hidden") { f.hidden = true; continue; }
    if (token === "!hidden" || token === "-hidden") { f.hidden = false; continue; }
    f.text.push(token);
  }
  return f;
}

function matchesFilter(file: FileRec, filter: FileFilter) {
  if (filter.ext && extOf(file.name) !== filter.ext) return false;
  if (filter.type && file.kind !== filter.type && !file.name.toLowerCase().includes(filter.type)) return false;
  if (filter.folder && !file.folder.toLowerCase().includes(filter.folder)) return false;
  if (filter.channel && !file.where.toLowerCase().includes(filter.channel)) return false;
  if (filter.min != null && file.size < filter.min) return false;
  if (filter.max != null && file.size > filter.max) return false;
  if (filter.after != null && file.at < filter.after) return false;
  if (filter.before != null && file.at > filter.before) return false;
  if (filter.hidden === true && !file.hidden) return false;
  if (filter.hidden === false && file.hidden) return false;
  const hay = `${file.name} ${file.folder} ${file.where} ${file.kind}`.toLowerCase();
  return filter.text.every((t) => hay.includes(t));
}

function FolderRow({ path, grid, checkboxes }: { path: string; grid: boolean; checkboxes: boolean }) {
  const v = useVault();
  const { folderMenu } = useMenus();
  const { over, props } = useFolderDrop(path);
  const n = v.folderCount(path);
  const name = path.split("/").pop()!;
  return (
    <div
      {...props}
      draggable
      data-folder-id={path}
      onDragStart={(e) => {
        e.dataTransfer.setData(FOLDER_MIME, path);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => v.clearSelection()}
      onDoubleClick={() => v.go(path)}
      onContextMenu={(e) => v.openMenu(e, folderMenu(path))}
      className={
        grid
          ? `flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-transparent p-3 hover:border-line hover:bg-panel ${over ? "drop-hl" : ""}`
          : `grid cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 hover:bg-panel ${checkboxes ? "grid-cols-[22px_1fr_90px_140px_150px]" : "grid-cols-[1fr_90px_140px_150px]"} ${over ? "drop-hl" : ""}`
      }
    >
      {grid ? (
        <>
          <FolderIcon size={40} />
          <div className="w-full truncate text-center">{name}</div>
          <div className="text-[11px] text-muted">{n} file{n === 1 ? "" : "s"}</div>
        </>
      ) : (
        <>
          {checkboxes && <div />}
          <div className="flex min-w-0 items-center gap-2.5"><FolderIcon /> <span className="truncate font-medium">{name}</span></div>
          <div className="text-right text-muted">{n} item{n === 1 ? "" : "s"}</div>
          <div className="text-muted">Folder</div>
          <div />
        </>
      )}
    </div>
  );
}

function FileRow({ f, grid, showFolder, checkboxes, selected, focused, onClick }: {
  f: FileRec; grid: boolean; showFolder: boolean; checkboxes: boolean; selected: boolean; focused: boolean;
  onClick: (e: React.MouseEvent, id: number) => void;
}) {
  const v = useVault();
  const { fileMenu } = useMenus();
  const state = selected
    ? "border-accent bg-accent/10 ring-1 ring-accent/60"
    : focused
      ? "border-accent/50 hover:bg-panel"
      : "border-transparent hover:border-line hover:bg-panel";
  const listState = selected
    ? "bg-accent/15 ring-1 ring-accent/60"
    : focused
      ? "ring-1 ring-accent/40 hover:bg-panel"
      : "hover:bg-panel";
  return (
    <div
      draggable
      data-file-id={f.id}
      onDragStart={(e) => {
        const dragged = v.selected.length > 1 && v.selected.includes(f.id) ? v.selected : [f.id];
        e.dataTransfer.setData(FILE_MIME, encodeDragIds(dragged));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => onClick(e, f.id)}
      onContextMenu={(e) => {
        if (!v.selected.includes(f.id)) v.setSelection([f.id], f.id, f.id);
        v.openMenu(e, fileMenu(f));
      }}
      className={
        grid
          ? `relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-3 ${state}`
          : `grid cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 ${checkboxes ? "grid-cols-[22px_1fr_90px_140px_150px]" : "grid-cols-[1fr_90px_140px_150px]"} ${listState}`
      }
    >
      {checkboxes && (
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${f.name}`}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={() => v.toggleSelected(f.id)}
          className="h-3.5 w-3.5 shrink-0"
        />
      )}
      {grid ? (
        <>
          <KindIcon kind={f.kind} name={f.name} size={40} />
          <div className="w-full truncate text-center" title={f.name}>{f.name}</div>
          <div className="text-[11px] text-muted">{fmtSize(f.size)}</div>
          {f.hidden && <span className="absolute right-1.5 top-1.5 text-muted" title="Hidden"><EyeOff size={12} /></span>}
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2.5">
            <KindIcon kind={f.kind} name={f.name} />
            <span className="truncate">{f.name}</span>
            {f.parts.length > 1 && <span className="shrink-0 rounded bg-panel2 px-1.5 text-[10px] text-muted">{f.parts.length} parts</span>}
            {showFolder && <span className="shrink-0 truncate text-[11px] text-muted">in {f.folder}</span>}
            {f.hidden && <EyeOff size={12} className="shrink-0 text-muted" />}
          </div>
          <div className="text-right text-muted">{fmtSize(f.size)}</div>
          <div className="truncate text-muted">{f.where}</div>
          <div className="truncate text-muted">{new Date(f.at).toLocaleDateString(undefined, { dateStyle: "medium" })}</div>
        </>
      )}
    </div>
  );
}

function PreviewBox({ id }: { id: number }) {
  const { preview } = useVault();
  const [p, setP] = useState<Preview | null>(null);
  useEffect(() => {
    let live = true;
    setP(null);
    preview(id).then((r) => live && setP(r));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!p) return <div className="flex items-center gap-2 rounded-lg border border-line bg-bg p-4 text-muted"><Loader2 size={14} className="spin" /> Fetching preview from Telegram…</div>;
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-line bg-bg">
        {p.type === "note" && <div className="p-4 text-muted">{p.note}</div>}
        {p.type === "text" && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[12px] leading-relaxed">{p.text}</pre>}
        {p.type === "image" && <img src={p.url} alt="" className="max-h-72 w-full object-contain" />}
        {p.type === "pdf" && <iframe src={p.url} title="pdf" className="h-72 w-full" />}
        {p.type === "audio" && <audio src={p.url} controls className="w-full p-2" />}
        {p.type === "video" && <video src={p.url} controls className="max-h-72 w-full" />}
      </div>
      {p.type !== "note" && p.note && <div className="mt-1.5 text-[11px] text-muted">{p.note}</div>}
    </div>
  );
}

function Details({ f }: { f: FileRec }) {
  const v = useVault();
  const row = (icon: React.ReactNode, k: string, val: React.ReactNode) => (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-0.5 text-muted">{icon}</span>
      <span className="w-16 shrink-0 text-muted">{k}</span>
      <span className="min-w-0 flex-1 break-words">{val}</span>
    </div>
  );
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-line bg-panel xl:w-80">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <KindIcon kind={f.kind} name={f.name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="break-words font-semibold leading-snug">{f.name}</div>
          <div className="text-muted">{fmtSize(f.size)} · {f.kind}</div>
        </div>
        <button onClick={() => v.clearSelection()} className="text-muted hover:text-fg"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <div className="flex flex-wrap gap-2">
          <Btn primary onClick={() => v.download(f.id)}><Download size={14} /> Download</Btn>
          <Btn onClick={() => v.openLink(f.id)} disabled={!f.link}><ExternalLink size={14} /> Telegram</Btn>
          <Btn onClick={() => v.setDialog({ type: "move", ids: [f.id] })}><FolderInput size={14} /> Move</Btn>
          <Btn danger onClick={() => v.setDialog({ type: "confirm", title: "Remove file", text: `Remove "${f.name}" from Vault's index? The Telegram message is not deleted.`, ok: "Remove", onOk: () => v.removeFile(f.id) })}><Trash2 size={14} /></Btn>
        </div>
        <PreviewBox id={f.id} />
        <div className="divide-y divide-line/60 text-[12.5px]">
          {row(<Radio size={13} />, "Channel", f.where)}
          {row(<FolderI size={13} />, "Folder", <button className="text-accent hover:underline" onClick={() => v.go(f.folder)}>{f.folder}</button>)}
          {row(<Bot size={13} />, "From", f.from)}
          {row(<Calendar size={13} />, "Modified", fmtDate(f.at))}
          {row(<Layers size={13} />, "Parts", f.parts.length > 1 ? `${f.parts.length} × ≤19 MB (msgs ${f.parts[0].msg}–${f.parts[f.parts.length - 1].msg})` : `1 (msg ${f.parts[0]?.msg})`)}
          {row(<HardDrive size={13} />, "Download", f.dl ? "Direct" : <span className="text-danger">Over 20 MB bot file — use /get {f.id}</span>)}
          {f.link && row(<Link2 size={13} />, "Link", <span className="selectable break-all text-muted">{f.link}</span>)}
          {row(<span className="text-[10px]">#</span>, "ID", f.id)}
        </div>
      </div>
    </aside>
  );
}

function MultiDetails({ files }: { files: FileRec[] }) {
  const v = useVault();
  const ids = files.map((f) => f.id);
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-line bg-panel xl:w-80">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent"><ListChecks size={18} /></div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{files.length} files selected</div>
          <div className="text-muted">{fmtSize(files.reduce((n, f) => n + f.size, 0))} total</div>
        </div>
        <button onClick={() => v.clearSelection()} className="text-muted hover:text-fg"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <div className="flex flex-wrap gap-2">
          <Btn primary onClick={() => ids.forEach((id) => v.download(id))}><Download size={14} /> Download all</Btn>
          <Btn onClick={() => v.setDialog({ type: "move", ids })}><FolderInput size={14} /> Move all</Btn>
          <Btn danger onClick={() => v.setDialog({
            type: "confirm", title: "Remove files",
            text: `Remove ${files.length} files from Vault's index? The Telegram messages are not deleted.`,
            ok: "Remove", onOk: () => ids.forEach((id) => v.removeFile(id)),
          })}><Trash2 size={14} /> Delete all</Btn>
        </div>
        <div className="divide-y divide-line/60 text-[12.5px]">
          {files.slice(0, 40).map((f) => (
            <button key={f.id} onClick={() => v.setSelection([f.id], f.id, f.id)} className="flex w-full items-center gap-2 py-1.5 text-left hover:text-accent">
              <KindIcon kind={f.kind} name={f.name} size={14} />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-[11px] text-muted">{fmtSize(f.size)}</span>
            </button>
          ))}
          {files.length > 40 && <div className="pt-2 text-[11px] text-muted">…and {files.length - 40} more</div>}
        </div>
      </div>
    </aside>
  );
}

export function FilesPage() {
  const v = useVault();
  const { path, db } = v;
  const { bgMenu, newSub, uploadHere } = useMenus();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [asc, setAsc] = useState(true);
  const [grid, setGrid] = useState(() => localStorage.getItem("vaultView") === "grid");
  const [checkboxes, setCheckboxes] = useState(() => localStorage.getItem("vaultCheckboxes") === "1");
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem("vaultShowHidden") === "1");
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number; additive: boolean; moved: boolean } | null>(null);
  const suppressClear = useRef(false);

  useEffect(() => localStorage.setItem("vaultView", grid ? "grid" : "list"), [grid]);
  useEffect(() => localStorage.setItem("vaultCheckboxes", checkboxes ? "1" : "0"), [checkboxes]);
  useEffect(() => localStorage.setItem("vaultShowHidden", showHidden ? "1" : "0"), [showHidden]);

  const hasQuery = !!q.trim();
  const filter = useMemo(() => parseFilter(q.trim().toLowerCase()), [q]);
  const folders = useMemo(
    () => v.childFolders(path).filter((f) => !filter.text.length || filter.text.every((t) => f.toLowerCase().includes(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.folders, path, filter]
  );
  const files = useMemo(() => {
    const base = hasQuery
      ? db.files.filter((f) => (showHidden || !f.hidden) && matchesFilter(f, filter))
      : db.files.filter((f) => f.folder === path && (showHidden || !f.hidden));
    const dir = asc ? 1 : -1;
    return [...base].sort((a, b) => {
      const r = sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? a.size - b.size : sort === "date" ? a.at - b.at : a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
      return r * dir;
    });
  }, [db.files, path, hasQuery, filter, sort, asc, showHidden]);

  const ids = files.map((f) => f.id);
  const indexOf = (id: number | null) => (id == null ? -1 : files.findIndex((f) => f.id === id));
  const rangeIds = (from: number | null, to: number) => {
    const a = indexOf(from), b = indexOf(to);
    if (a < 0 || b < 0) return [to];
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return files.slice(lo, hi + 1).map((f) => f.id);
  };
  const scrollTo = (id: number) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-file-id="${id}"]`);
    el?.scrollIntoView({ block: "nearest" });
  };
  const selectAll = () => v.setSelection(ids, ids[ids.length - 1] ?? null, ids[0] ?? null);
  const invert = () => {
    const set = new Set(v.selected);
    const next = ids.filter((id) => !set.has(id));
    v.setSelection(next, next[next.length - 1] ?? null, v.anchorId);
  };

  const onClickFile = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const anchor = v.anchorId ?? v.focusId ?? id;
      const range = rangeIds(anchor, id);
      const next = additive ? [...new Set([...v.selected, ...range])] : range;
      v.setSelection(next, id, anchor);
    } else if (additive) {
      v.toggleSelected(id);
    } else {
      v.setSelection([id], id, id);
    }
    scrollTo(id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
    if (v.dialog || v.menu || !ids.length) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "a") { e.preventDefault(); selectAll(); return; }
    if (key === "escape") {
      if (dragRef.current) { dragRef.current = null; setMarquee(null); }
      else v.clearSelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === " ") {
      e.preventDefault();
      v.toggleSelected(v.focusId ?? v.selId ?? ids[0]);
      return;
    }
    const current = indexOf(v.focusId ?? v.selId);
    let next = -1;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ids.length - 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") next = Math.min(ids.length - 1, (current < 0 ? -1 : current) + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = Math.max(0, (current < 0 ? ids.length : current) - 1);
    if (next < 0) return;
    e.preventDefault();
    const id = ids[next];
    if (e.shiftKey) {
      const anchor = v.anchorId ?? v.focusId ?? id;
      const range = rangeIds(anchor, id);
      const additive = e.ctrlKey || e.metaKey;
      v.setSelection(additive ? [...new Set([...v.selected, ...range])] : range, id, anchor);
    } else if (e.ctrlKey || e.metaKey) {
      v.setSelection(v.selected, id, v.anchorId ?? id);
    } else {
      v.setSelection([id], id, id);
    }
    scrollTo(id);
  };
  // Selection shortcuts work anywhere on the files page, not only when the list has focus.
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const point = (e: React.MouseEvent) => {
    const el = listRef.current!;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
  };
  const onListMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !listRef.current) return;
    suppressClear.current = false;
    const target = e.target as HTMLElement;
    if (target.closest("[data-file-id], [data-folder-id], button, input, select, a")) return;
    listRef.current.focus({ preventScroll: true });
    const p = point(e);
    dragRef.current = { x: p.x, y: p.y, cx: e.clientX, cy: e.clientY, additive: e.ctrlKey || e.metaKey, moved: false };
    setMarquee({ left: p.x, top: p.y, width: 0, height: 0 });
  };
  const onListMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = point(e);
    if (Math.abs(e.clientX - d.cx) > 3 || Math.abs(e.clientY - d.cy) > 3) d.moved = true;
    setMarquee({
      left: Math.min(d.x, p.x), top: Math.min(d.y, p.y),
      width: Math.abs(p.x - d.x), height: Math.abs(p.y - d.y),
    });
  };
  const onListMouseUp = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setMarquee(null);
    if (!d.moved) return;
    suppressClear.current = true;
    const left = Math.min(d.cx, e.clientX), right = Math.max(d.cx, e.clientX);
    const top = Math.min(d.cy, e.clientY), bottom = Math.max(d.cy, e.clientY);
    const hit = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-file-id]") ?? [])]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom;
      })
      .map((el) => Number(el.dataset.fileId))
      .filter((id): id is number => Number.isFinite(id));
    const base = d.additive ? v.selected : [];
    v.setSelection([...new Set([...base, ...hit])], hit[hit.length - 1] ?? v.focusId, v.anchorId);
  };

  const single = v.selected.length === 1 ? db.files.find((f) => f.id === v.selId) ?? null : null;
  const multi = v.selected.length > 1 ? db.files.filter((f) => v.selected.includes(f.id)) : [];
  const empty = !folders.length && !files.length;

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className="flex min-w-0 flex-1 flex-col"
        onContextMenu={(e) => v.openMenu(e, bgMenu(path, { ids, showCheckboxes: checkboxes, toggleCheckboxes: () => setCheckboxes((c) => !c) }))}
        onClick={() => v.clearSelection()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
          <div className="relative min-w-[170px] flex-1 basis-64 sm:max-w-md">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Filter: name, *.pdf, type:image, size:>10mb, modified:>2026-01-01"
              className={`${inputCls} pl-8`}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-24 rounded-md border border-line bg-bg px-2 py-1.5">
              <option value="name">Name</option><option value="size">Size</option><option value="date">Modified</option><option value="kind">Type</option>
            </select>
            <button onClick={() => setAsc(!asc)} className="grid h-8 w-8 place-items-center rounded-md border border-line bg-panel2 hover:border-accent" title="Toggle order">
              {asc ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}
            </button>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            <Btn onClick={selectAll} title="Select all (Ctrl+A)" className="px-2.5"><CheckCheck size={14} /> <span className="hidden lg:inline">Select all</span></Btn>
            <Btn onClick={invert} title="Invert selection" className="px-2.5"><ListChecks size={14} /> <span className="hidden lg:inline">Invert</span></Btn>
            <button onClick={() => setCheckboxes((c) => !c)} title={checkboxes ? "Hide item check boxes" : "Show item check boxes"} className={`grid h-8 w-8 place-items-center rounded-md border ${checkboxes ? "border-accent bg-accent/15 text-accent" : "border-line bg-panel2"}`}><CheckSquare size={15} /></button>
            <button onClick={() => setShowHidden((s) => !s)} title={showHidden ? "Hide hidden files" : "Show hidden files"} className={`grid h-8 w-8 place-items-center rounded-md border ${showHidden ? "border-accent bg-accent/15 text-accent" : "border-line bg-panel2"}`}>{showHidden ? <Eye size={15} /> : <EyeOff size={15} />}</button>
            <Btn onClick={() => newSub(path)} className="px-2.5"><FolderPlus size={14} /> <span className="hidden md:inline">New folder</span></Btn>
            <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
              <button onClick={() => setGrid(false)} className={`grid h-8 w-8 place-items-center ${!grid ? "bg-accent text-accentfg" : "bg-panel2"}`} title="List"><List size={15} /></button>
              <button onClick={() => setGrid(true)} className={`grid h-8 w-8 place-items-center ${grid ? "bg-accent text-accentfg" : "bg-panel2"}`} title="Grid"><LayoutGrid size={15} /></button>
            </div>
          </div>
        </div>

        <div
          ref={listRef}
          tabIndex={0}
          onMouseDown={onListMouseDown}
          onMouseMove={onListMouseMove}
          onMouseUp={onListMouseUp}
          onMouseLeave={(e) => { if (dragRef.current?.moved) onListMouseUp(e); }}
          onClick={(e) => { if (suppressClear.current) { suppressClear.current = false; e.stopPropagation(); } }}
          className="relative min-h-0 flex-1 overflow-auto p-3 outline-none"
        >
          {!grid && !empty && (
            <div className={`grid gap-3 px-3 pb-1 text-[11px] uppercase tracking-wider text-muted ${checkboxes ? "grid-cols-[22px_1fr_90px_140px_150px]" : "grid-cols-[1fr_90px_140px_150px]"}`}>
              {checkboxes && <div />}
              <div>Name</div><div className="text-right">Size</div><div>Channel</div><div>Modified</div>
            </div>
          )}
          <div className={grid ? "grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2" : "space-y-px"}>
            {folders.map((f) => <FolderRow key={f} path={f} grid={grid} checkboxes={checkboxes} />)}
            {files.map((f) => (
              <FileRow
                key={f.id} f={f} grid={grid} showFolder={!!hasQuery} checkboxes={checkboxes}
                selected={v.selected.includes(f.id)} focused={v.focusId === f.id} onClick={onClickFile}
              />
            ))}
          </div>
          {marquee && <div style={marquee} className="pointer-events-none absolute z-10 rounded-sm border border-accent bg-accent/10" />}
          {empty && (
            <div className="mx-auto mt-16 max-w-sm text-center text-muted">
              <UploadIcon size={34} className="mx-auto mb-3 opacity-60" />
              <div className="mb-1 text-[15px] font-medium text-fg">{hasQuery ? "No matches" : "This folder is empty"}</div>
              <div className="mb-4">{hasQuery ? "Try a different filter." : "Drop files anywhere in the window, or upload straight into this folder."}</div>
              {!hasQuery && <Btn primary onClick={() => uploadHere(path)}><UploadIcon size={14} /> Upload here</Btn>}
            </div>
          )}
        </div>
      </div>
      {single && <Details f={single} />}
      {multi.length > 1 && <MultiDetails files={multi} />}
    </div>
  );
}
