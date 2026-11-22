import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Pin, PinOff, Upload, Palette, Send, Vault,
  Minus, Square, Copy, X,
} from "lucide-react";
import { THEMES, useVault } from "../store";
import { useFolderDrop } from "../dnd";
import { Btn } from "../ui";

function Crumb({ label, path }: { label: string; path: string }) {
  const { go } = useVault();
  const { over, props } = useFolderDrop(path);
  return (
    <button
      {...props}
      onClick={() => go(path)}
      className={`rounded px-1.5 py-0.5 hover:bg-panel2 ${over ? "drop-hl" : ""}`}
    >
      {label}
    </button>
  );
}

export function TopBar() {
  const v = useVault();
  const { db, path } = v;
  const input = useRef<HTMLInputElement>(null);
  const winApi = window.vaultDesktop?.window;
  const [maximized, setMaximized] = useState(false);
  const remembered = db.cfg.default_channels ?? [];
  const destId = v.dest ?? remembered[0] ?? db.channels[0]?.id ?? null;
  const pinned = destId != null && remembered.includes(destId);
  const segs = path ? path.split("/") : [];

  useEffect(() => {
    if (!winApi) return;
    let live = true;
    winApi.isMaximized().then((m) => { if (live) setMaximized(m); }).catch(() => {});
    const off = winApi.onMaximized(setMaximized);
    return () => { live = false; off(); };
  }, [winApi]);

  const toggleMaximize = async () => {
    if (!winApi) return;
    setMaximized(await winApi.toggleMaximize());
  };

  const IconBtn = ({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string }) => (
    <button title={title} disabled={disabled} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-panel2 hover:text-fg disabled:opacity-30">
      {children}
    </button>
  );

  return (
    <header
      className={`app-drag flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel pl-3 ${winApi ? "pr-0" : "pr-3"}`}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, input, select, a")) void toggleMaximize();
      }}
    >
      <div className="mr-2 flex shrink-0 items-center gap-2 font-semibold tracking-wide">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accentfg"><Vault size={16} /></span>
        <span className="hidden md:inline">VAULT</span>
      </div>
      <IconBtn title="Back" onClick={v.back} disabled={!v.canBack}><ArrowLeft size={16} /></IconBtn>
      <IconBtn title="Forward" onClick={v.fwd} disabled={!v.canFwd}><ArrowRight size={16} /></IconBtn>
      <IconBtn title="Up" onClick={v.up} disabled={!path}><ArrowUp size={16} /></IconBtn>
      <IconBtn title="Refresh" onClick={v.refresh}><RefreshCw size={15} /></IconBtn>

      <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded-md border border-line bg-bg px-1.5 py-1 text-[13px]">
        <Crumb label="Vault" path="" />
        {segs.map((s, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <span className="text-muted">/</span>
            <Crumb label={s} path={segs.slice(0, i + 1).join("/")} />
          </span>
        ))}
      </nav>

      <div className="hidden shrink-0 items-center gap-1 lg:flex">
        <span className="text-muted">Upload to</span>
        <select
          value={v.dest ?? ""}
          onChange={(e) => v.setDest(e.target.value ? Number(e.target.value) : null)}
          className="max-w-40 rounded-md border border-line bg-bg px-2 py-1.5"
        >
          <option value="">Auto (remembered channels)</option>
          {db.channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <IconBtn title={pinned ? "Remembered channel" : "Pin as remembered channel"} onClick={() => destId != null && v.setDefault(pinned ? null : destId)}>
          {pinned ? <Pin size={15} className="text-accent" fill="currentColor" /> : <PinOff size={15} />}
        </IconBtn>
      </div>

      <input
        ref={input} type="file" multiple hidden
        onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) v.upload(fs, path || "General", v.dest ?? null); }}
      />
      <Btn primary onClick={() => input.current?.click()} className="shrink-0"><Upload size={14} /> <span className="hidden md:inline">Upload</span></Btn>
      <IconBtn title="Telegram bot simulator" onClick={() => v.setBotOpen(!v.botOpen)}><Send size={16} className={v.botOpen ? "text-accent" : ""} /></IconBtn>
      <button title="Cycle color palette" onClick={v.cycleTheme} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-panel2 hover:text-fg">
        <Palette size={16} /> <span className="hidden text-[12px] xl:inline">{THEMES[v.theme]}</span>
      </button>

      {winApi && (
        <div className="app-no-drag -mr-0 ml-1 flex h-12 shrink-0 items-stretch">
          <button title="Minimize" onClick={() => void winApi.minimize()} className="grid w-11 place-items-center text-muted hover:bg-panel2 hover:text-fg">
            <Minus size={16} />
          </button>
          <button title={maximized ? "Restore" : "Maximize"} onClick={() => void toggleMaximize()} className="grid w-11 place-items-center text-muted hover:bg-panel2 hover:text-fg">
            {maximized ? <Copy size={14} /> : <Square size={14} />}
          </button>
          <button title="Close" onClick={() => void winApi.close()} className="grid w-11 place-items-center text-muted hover:bg-danger hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}
    </header>
  );
}
