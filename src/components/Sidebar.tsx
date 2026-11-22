import { useState } from "react";
import { LayoutDashboard, Files, Radio, Settings as Cog, ChevronRight, Brain, Bot, Sparkles } from "lucide-react";
import { useVault, type Page } from "../store";
import { FOLDER_MIME, useFolderDrop } from "../dnd";
import { FolderIcon } from "../ui";
import { useMenus } from "../menus";

function Node({ path, depth }: { path: string; depth: number }) {
  const v = useVault();
  const { folderMenu } = useMenus();
  const kids = v.childFolders(path);
  const [open, setOpen] = useState(depth < 1 || v.path.startsWith(path + "/"));
  const { over, props } = useFolderDrop(path);
  const active = v.page === "files" && v.path === path;
  const expanded = open || v.path.startsWith(path + "/");
  return (
    <div>
      <div
        {...props}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(FOLDER_MIME, path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => v.go(path)}
        onDoubleClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => v.openMenu(e, folderMenu(path))}
        style={{ paddingLeft: 6 + depth * 14 }}
        className={`group flex cursor-pointer items-center gap-1 rounded-md py-1 pr-2 ${active ? "bg-accent/15 text-fg" : "text-fg/85 hover:bg-panel2"} ${over ? "drop-hl" : ""}`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!expanded); }}
          className={`grid h-4 w-4 place-items-center text-muted ${kids.length ? "" : "invisible"}`}
        >
          <ChevronRight size={12} className={`transition ${expanded ? "rotate-90" : ""}`} />
        </button>
        <FolderIcon size={15} open={active} />
        <span className="min-w-0 flex-1 truncate">{path.split("/").pop()}</span>
        <span className="text-[11px] text-muted">{v.folderCount(path)}</span>
      </div>
      {expanded && kids.map((k) => <Node key={k} path={k} depth={depth + 1} />)}
    </div>
  );
}

export function Sidebar() {
  const v = useVault();
  const { db } = v;
  const nav: [Page, string, typeof Files][] = [
    ["overview", "Overview", LayoutDashboard],
    ["files", "Files", Files],
    ["channels", "Channels", Radio],
    ["settings", "Settings", Cog],
  ];
  const { over, props } = useFolderDrop("");
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel xl:w-60">
      <div className="space-y-0.5 p-2">
        {nav.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => (id === "files" ? v.go(v.path, false) : v.setPage(id))}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left font-medium ${v.page === id ? "bg-accent text-accentfg" : "text-fg/85 hover:bg-panel2"}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Folders</div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2" {...props}>
        <div
          onClick={() => v.go("")}
          className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${v.page === "files" && v.path === "" ? "bg-accent/15" : "hover:bg-panel2"} ${over ? "drop-hl" : ""}`}
        >
          <FolderIcon size={15} /> <span className="flex-1">All files</span>
          <span className="text-[11px] text-muted">{db.files.length}</span>
        </div>
        {v.childFolders("").map((f) => <Node key={f} path={f} depth={0} />)}
      </div>

      <div className="space-y-2 border-t border-line p-3 text-[12px]">
        <div className="flex items-center gap-2">
          <Brain size={15} className="text-accent" />
          <div className="min-w-0 flex-1" title={v.python.status}>
            <div className="truncate font-medium">{v.python.running ? "Python engine" : "Built-in model"}</div>
            <div className="truncate text-muted">{v.python.running ? v.python.samples : db.model.n} learned · {v.python.running ? v.python.classes : Object.keys(db.model.classes).length} classes</div>
          </div>
          <button onClick={v.train} className="flex items-center gap-1 rounded-md border border-line bg-panel2 px-2 py-1 hover:border-accent">
            <Sparkles size={12} /> Train
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Bot size={15} className={db.bot ? "text-ok" : "text-muted"} />
          <div className="min-w-0 flex-1 truncate">
            {db.bot ? <>@{db.bot.username}</> : "Bot not connected"}
            <div className="text-muted">{db.bot ? (db.cfg.owner ? "Owner locked" : "Waiting for /start") : "Add a token in Settings"}</div>
          </div>
          <span className={`h-2 w-2 rounded-full ${db.bot ? "bg-ok" : "bg-muted"}`} />
        </div>
      </div>
    </aside>
  );
}
