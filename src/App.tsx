import { useEffect, useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { VaultProvider, fmtSize, useVault } from "./store";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { BotSim } from "./components/BotSim";
import { ContextMenu, Dialogs, Toast } from "./ui";
import { FilesPage } from "./pages/Files";
import { OverviewPage } from "./pages/Overview";
import { ChannelsPage } from "./pages/Channels";
import { SettingsPage } from "./pages/Settings";
import { FILE_MIME } from "./dnd";

function Shell() {
  const v = useVault();
  const { db, page, busy } = v;
  const [dragging, setDragging] = useState(false);
  const vRef = useLatest(v);

  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files") && !e.dataTransfer.types.includes(FILE_MIME);
    const enter = (e: DragEvent) => { if (isFiles(e)) { depth++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (isFiles(e) && --depth <= 0) { depth = 0; setDragging(false); } };
    const over = (e: DragEvent) => { if (isFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault(); depth = 0; setDragging(false);
      const fs = [...(e.dataTransfer?.files ?? [])];
      if (fs.length) vRef.current.upload(fs, vRef.current.page === "files" ? vRef.current.path || "General" : "General", null);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const total = db.files.reduce((a, f) => a + f.size, 0);
  return (
    <div className="relative flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          {page === "overview" && <OverviewPage />}
          {page === "files" && <FilesPage />}
          {page === "channels" && <ChannelsPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[12px] text-muted">
        <span>{db.files.length} files</span>
        <span>{db.channels.length} channels</span>
        <span>{fmtSize(total)} in Telegram</span>
        <span className="ml-auto flex items-center gap-1.5 text-fg">
          {busy && <Loader2 size={12} className="spin text-accent" />} {busy}
        </span>
      </footer>
      <BotSim />
      <ContextMenu />
      <Dialogs />
      <Toast />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-bg/70 backdrop-blur-sm">
          <div className="drop-hl rounded-2xl border-2 border-dashed border-accent px-16 py-12 text-center">
            <UploadCloud size={44} className="mx-auto mb-3 text-accent" />
            <div className="text-lg font-semibold">Drop to upload</div>
            <div className="text-muted">into {page === "files" && v.path ? v.path : "General"}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function useLatest<T>(x: T) {
  const r = useRef(x);
  r.current = x;
  return r;
}

export default function App() {
  return (
    <VaultProvider>
      <Shell />
    </VaultProvider>
  );
}
