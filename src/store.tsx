import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { emptyModel, extOf, kindOf, learn, mkDest, parseDest, predict, type Model, type Prediction } from "./brain";
import { makeSeed } from "./seed";

export interface Part { msg: number; fid: string }
export interface FileRec {
  id: number; name: string; size: number; kind: string; where: string; folder: string;
  from: "Bot" | "Channel" | "Desktop"; at: number; link?: string; chat: number; parts: Part[]; dl: boolean;
  hidden?: boolean;
}
export interface Channel { id: number; title: string; username?: string }
export interface Db {
  cfg: { token: string; owner: number | null; auto: boolean; default_channels: number[] };
  channels: Channel[]; files: FileRec[]; log: { t: number; msg: string }[]; folders: string[];
  model: Model; nextId: number; nextMsg: number; bot: { username: string } | null;
}
export interface Blob { file?: File; text?: string; url?: string; mime?: string }
export type Preview =
  | { type: "text"; text: string; note?: string }
  | { type: "image" | "pdf" | "audio" | "video"; url: string; note?: string }
  | { type: "note"; note: string };
export type Page = "overview" | "files" | "channels" | "settings";
export interface MenuItem { label: string; onClick: () => void; danger?: boolean; sep?: boolean; icon?: ReactNode }
export type Dialog =
  | { type: "prompt"; title: string; label?: string; value: string; ok: string; onOk: (v: string) => void }
  | { type: "confirm"; title: string; text: string; ok: string; onOk: () => void }
  | { type: "move"; ids: number[] }
  | { type: "moveFolder"; name: string };

export const PART = 19 * 1024 * 1024;
export const THEMES = ["Midnight", "Graphite", "Aurora", "Paper", "Sunset"];
const TEXT_EXT = ["txt", "md", "csv", "json", "xml", "yaml", "yml", "toml", "log", "sql", "ini", "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "sh", "bat", "html", "css", "rb", "php"];
const MEDIA: Record<string, Preview["type"]> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image",
  pdf: "pdf", mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio",
  mp4: "video", webm: "video", mov: "video",
};

export const fmtSize = (n: number) => {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < 3);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
};
export const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const normFolder = (s: string) => s.replace(/\\/g, "/").split("/").map((x) => x.trim()).filter(Boolean).join("/");
export const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KEY = "vault.json";
const MIGRATED_KEY = "vault.examplesCleared";
const DEMO_TOKEN = "000000:demo-token-for-browser-preview-only";
const DEMO_BOT = "vault_demo_bot";
const EXAMPLE_FILES = new Set([
  "Q1_report.pdf", "invoice_jan.pdf", "invoice_feb.pdf", "invoice_mar.pdf",
  "meeting_notes.md", "budget_2026.csv", "sunset.svg", "holiday_video.mp4",
  "config.json", "todo.txt", "backup_2025.zip", "podcast_ep12.mp3",
]);
const EXAMPLE_CHANNEL_IDS = new Set([-1001234567890, -1009876543210]);
const EXAMPLE_FOLDERS = new Set(["Work", "Photos", "Archives", "Media"]);
const EXAMPLE_LOGS = new Set([
  "Indexed podcast_ep12.mp3 → Personal / Media",
  "Bot saved todo.txt → Personal / General",
  "Bot saved meeting_notes.md → Work Docs / Work/Notes",
]);

function load(): Db | null {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const d = JSON.parse(s) as Db;

    // One-time cleanup: remove the old sample data, but keep anything the user added.
    if (!localStorage.getItem(MIGRATED_KEY)) {
      const isExampleFile = (f: FileRec) =>
        EXAMPLE_FILES.has(f.name) && (f.id <= 12 || EXAMPLE_CHANNEL_IDS.has(f.chat));
      const hasExamples =
        d.cfg?.token === DEMO_TOKEN ||
        d.bot?.username === DEMO_BOT ||
        (d.files ?? []).some(isExampleFile);

      if (hasExamples) {
        d.files = (d.files ?? []).filter((f) => !isExampleFile(f));
        d.channels = (d.channels ?? []).filter((c) => !EXAMPLE_CHANNEL_IDS.has(c.id));
        d.folders = (d.folders ?? []).filter((f) => {
          const root = f.split("/")[0];
          return !EXAMPLE_FOLDERS.has(root) || d.files.some((x) => x.folder.split("/")[0] === root);
        });
        d.log = (d.log ?? []).filter((l) => !EXAMPLE_LOGS.has(l.msg));
        if (d.cfg?.token === DEMO_TOKEN) {
          d.cfg.token = "";
          d.cfg.owner = null;
          d.cfg.default_channels = [];
        }
        if (d.bot?.username === DEMO_BOT) d.bot = null;

        const model = emptyModel();
        d.files.forEach((f) => learn(model, f.name, f.size, mkDest(f.chat, f.folder)));
        d.model = model;
        d.nextId = Math.max(1, ...d.files.map((f) => f.id + 1));
        d.nextMsg = Math.max(1, ...d.files.flatMap((f) => f.parts?.map((p) => p.msg + 1) ?? []));
        localStorage.setItem(KEY, JSON.stringify(d));
      }
      localStorage.setItem(MIGRATED_KEY, "1");
    }

    // Older versions remembered only one channel. Migrate that choice to a list.
    const cfg = d.cfg as unknown as { default_channel?: number | null; default_channels?: number[] };
    if (!Array.isArray(cfg.default_channels)) {
      cfg.default_channels = cfg.default_channel != null ? [cfg.default_channel] : [];
    }
    delete cfg.default_channel;
    return d;
  } catch { return null; }
}

interface Ctx {
  db: Db; page: Page; setPage: (p: Page) => void;
  path: string; go: (p: string, push?: boolean) => void; back: () => void; fwd: () => void; up: () => void;
  canBack: boolean; canFwd: boolean;
  selId: number | null; selected: number[]; focusId: number | null; anchorId: number | null;
  select: (id: number | null) => void;
  setSelection: (ids: number[], focusId?: number | null, anchorId?: number | null) => void;
  toggleSelected: (id: number) => void;
  clearSelection: () => void;
  folders: string[]; childFolders: (p: string) => string[]; folderCount: (p: string) => number;
  dest: number | null; setDest: (n: number | null) => void;
  theme: number; cycleTheme: () => void;
  busy: string; toast: (msg: string, kind?: "ok" | "err") => void; toastMsg: { msg: string; kind: "ok" | "err" } | null;
  menu: { x: number; y: number; items: MenuItem[] } | null; openMenu: (e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuItem[]) => void; closeMenu: () => void;
  dialog: Dialog | null; setDialog: (d: Dialog | null) => void;
  botOpen: boolean; setBotOpen: (b: boolean) => void;
  // actions
  connect: (token: string) => boolean; disconnect: () => void; unlock: () => void; setAuto: (b: boolean) => void;
  setDefault: (id: number | null) => void; addChannel: (input: string) => boolean; removeChannel: (id: number) => void;
  addFolder: (name: string) => void; renameFolder: (name: string, to: string) => void; deleteFolder: (name: string) => void;
  moveFolder: (name: string, target: string) => boolean;
  replaceFolders: (names: string[]) => void;
  upload: (files: File[], folder: string, chat: number | null) => Promise<void>;
  download: (id: number) => void; removeFile: (id: number) => void;
  moveFile: (id: number, folder: string) => void; moveFiles: (ids: number[], folder: string) => void;
  setHidden: (ids: number[], hidden: boolean) => void;
  openLink: (id: number) => void; suggest: (name: string, size: number, folder?: string) => Promise<Prediction>;
  train: () => Promise<void>; restartAI: () => Promise<void>; preview: (id: number) => Promise<Preview>;
  python: VaultPythonStatus;
  addRec: (o: { name: string; size: number; folder: string; chat: number; from: FileRec["from"]; file?: File; dl?: boolean; msg?: number; fid?: string; noLearn?: boolean }) => Promise<FileRec | null>;
  importChannel: (info: { id: number; title: string; username?: string }, files: { name: string; size: number; folder: string; msg: number; fid: string }[]) => Promise<number>;
  setOwner: (n: number) => void; logLine: (m: string) => void; hasBlob: (id: number) => boolean;
  refresh: () => void; tick: number;
}
const C = createContext<Ctx>(null as never);
export const useVault = () => useContext(C);

export function VaultProvider({ children }: { children: ReactNode }) {
  const seed = useRef<ReturnType<typeof makeSeed>>(undefined as never);
  if (!seed.current) seed.current = makeSeed();
  const blobs = useRef<Map<number, Blob>>(seed.current.blobs);
  const [db, setDb] = useState<Db>(() => load() ?? seed.current.db);
  const dbRef = useRef(db);
  const [page, setPage] = useState<Page>("files");
  const [hist, setHist] = useState<{ h: string[]; i: number }>({ h: [""], i: 0 });
  const [selection, setSelectionState] = useState<{ selected: number[]; focusId: number | null; anchorId: number | null }>({ selected: [], focusId: null, anchorId: null });
  const { selected, focusId, anchorId } = selection;
  const selId = selected[selected.length - 1] ?? focusId;
  const [dest, setDest] = useState<number | null>(null);
  const [theme, setTheme] = useState(() => {
    try { return Number(JSON.parse(localStorage.getItem("vaultUi") || "{}").theme) || 0; } catch { return 0; }
  });
  const [busy, setBusy] = useState("");
  const [toastMsg, setToastMsg] = useState<Ctx["toastMsg"]>(null);
  const [menu, setMenu] = useState<Ctx["menu"]>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [botOpen, setBotOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [pythonStatus, setPythonStatus] = useState<VaultPythonStatus>(() =>
    window.vaultDesktop?.python
      ? { status: "Python engine starting...", running: false, samples: 0, classes: 0, accuracy: null }
      : { status: "Built-in model (browser)", running: false, samples: 0, classes: 0, accuracy: null }
  );
  const pythonRef = useRef(pythonStatus);
  pythonRef.current = pythonStatus;
  const pythonApi = window.vaultDesktop?.python;
  const toastT = useRef<number>(0);

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(db)); }, [db]);
  useEffect(() => {
    localStorage.setItem("vaultUi", JSON.stringify({ theme }));
    document.documentElement.setAttribute("data-theme", String(theme));
  }, [theme]);

  useEffect(() => {
    if (!pythonApi) return;
    let alive = true;
    pythonApi.status().then((s) => { if (alive) setPythonStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [pythonApi]);

  const update = useCallback((fn: (d: Db) => void) => {
    const d = structuredClone(dbRef.current);
    fn(d);
    dbRef.current = d;
    setDb(d);
  }, []);
  const logLine = useCallback((msg: string) => update((d) => { d.log.unshift({ t: Date.now(), msg }); d.log = d.log.slice(0, 80); }), [update]);
  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToastMsg({ msg, kind });
    window.clearTimeout(toastT.current);
    toastT.current = window.setTimeout(() => setToastMsg(null), 3800);
  }, []);

  // ----- selection
  const clearSelection = useCallback(() => setSelectionState({ selected: [], focusId: null, anchorId: null }), []);
  const select = useCallback((id: number | null) => {
    if (id == null) clearSelection();
    else setSelectionState({ selected: [id], focusId: id, anchorId: id });
  }, [clearSelection]);
  const setSelection = useCallback((ids: number[], nextFocus?: number | null, nextAnchor?: number | null) => {
    const unique = [...new Set(ids)];
    const focus = nextFocus === undefined ? (unique[unique.length - 1] ?? null) : nextFocus;
    const anchor = nextAnchor === undefined ? (focus ?? unique[0] ?? null) : nextAnchor;
    setSelectionState({ selected: unique, focusId: focus, anchorId: anchor });
  }, []);
  const toggleSelected = useCallback((id: number) => {
    setSelectionState((s) => {
      const has = s.selected.includes(id);
      const next = has ? s.selected.filter((x) => x !== id) : [...s.selected, id];
      const focus = has
        ? (s.focusId && s.focusId !== id && next.includes(s.focusId) ? s.focusId : (next[next.length - 1] ?? null))
        : id;
      const anchor = s.anchorId && next.includes(s.anchorId) ? s.anchorId : (next[next.length - 1] ?? null);
      return { selected: next, focusId: focus, anchorId: anchor };
    });
  }, []);

  // ----- folders
  const folders = useMemo(() => {
    const s = new Set<string>();
    const add = (f: string) => { const p = f.split("/"); for (let i = 1; i <= p.length; i++) s.add(p.slice(0, i).join("/")); };
    db.folders.forEach((f) => f && add(f));
    db.files.forEach((f) => f.folder && add(f.folder));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [db.folders, db.files]);
  const childFolders = useCallback((p: string) => folders.filter((f) => parentOf(f) === p), [folders]);
  const folderCount = useCallback((p: string) => db.files.filter((f) => f.folder === p || f.folder.startsWith(p + "/")).length, [db.files]);

  // ----- navigation
  const path = hist.h[hist.i];
  const go = useCallback((p: string, push = true) => {
    setPage("files");
    select(null);
    setHist((s) => {
      if (!push || s.h[s.i] === p) return s;
      const h = s.h.slice(0, s.i + 1).concat(p);
      return { h, i: h.length - 1 };
    });
  }, []);
  const back = () => { select(null); setHist((s) => ({ ...s, i: Math.max(0, s.i - 1) })); };
  const fwd = () => { select(null); setHist((s) => ({ ...s, i: Math.min(s.h.length - 1, s.i + 1) })); };
  const up = () => go(parentOf(path));

  // ----- bot / cfg
  const connect = (token: string) => {
    const t = token.trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t)) { toast("That doesn't look like a BotFather token (123456:ABC…)", "err"); return false; }
    update((d) => { d.cfg.token = t; d.bot = { username: `vault_${t.slice(0, 4)}_bot` }; });
    logLine("Bot connected");
    toast("Bot connected — send it /start to claim ownership");
    return true;
  };
  const disconnect = () => { update((d) => { d.cfg.token = ""; d.bot = null; }); toast("Bot disconnected"); };
  const unlock = () => { update((d) => { d.cfg.owner = null; }); toast("Owner unlocked — send /start from the right account"); };
  const setOwner = (n: number) => update((d) => { d.cfg.owner = n; });
  const setAuto = (b: boolean) => update((d) => { d.cfg.auto = b; });
  const setDefault = (id: number | null) => {
    if (id == null) {
      update((d) => { d.cfg.default_channels = []; });
      toast("Remembered channels cleared");
      return;
    }
    let remembered = false;
    update((d) => {
      const ids = new Set(d.cfg.default_channels ?? []);
      if (ids.has(id)) ids.delete(id);
      else { ids.add(id); remembered = true; }
      d.cfg.default_channels = [...ids];
    });
    const c = dbRef.current.channels.find((x) => x.id === id);
    toast(c ? `${remembered ? "Remembered" : "Forgot"} channel: ${c.title}` : "Remembered channel updated");
  };

  const addChannel = (input: string) => {
    const s = input.trim();
    if (!dbRef.current.bot) { toast("Connect your bot in Settings first", "err"); return false; }
    let id: number, title: string, username: string | undefined;
    if (/^-?\d{6,}$/.test(s)) {
      id = Number(s.startsWith("-") ? s : "-100" + s);
      title = `Channel ${String(id).replace("-100", "")}`;
    } else if (/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s)) {
      username = s.replace(/^@/, "");
      let h = 7;
      for (const ch of username.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 999999937;
      id = -(1000000000000 + h);
      title = username.replace(/[_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
    } else { toast("Add channel failed: use @username or a numeric channel ID", "err"); return false; }
    if (dbRef.current.channels.some((c) => c.id === id)) { toast("Channel already added", "err"); return false; }
    update((d) => {
      d.channels.push({ id, title, username });
      if (!d.cfg.default_channels?.length) d.cfg.default_channels = [id];
    });
    logLine(`Channel added: ${title}`);
    toast(`Added ${title}`);
    return true;
  };
  const removeChannel = (id: number) => {
    update((d) => {
      d.channels = d.channels.filter((c) => c.id !== id);
      d.cfg.default_channels = (d.cfg.default_channels ?? []).filter((x) => x !== id);
    });
    toast("Channel forgotten — files stay indexed");
  };

  // ----- folder ops
  const addFolder = (name: string) => {
    const n = normFolder(name);
    if (!n) return;
    update((d) => { if (!d.folders.includes(n)) d.folders.push(n); });
    toast(`Folder "${n}" created`);
  };
  const renameFolder = (name: string, to: string) => {
    const t = normFolder(to);
    if (!t || t === name) return;
    const fix = (f: string) => (f === name ? t : f.startsWith(name + "/") ? t + f.slice(name.length) : f);
    update((d) => {
      d.files.forEach((f) => (f.folder = fix(f.folder)));
      d.folders = [...new Set(d.folders.map(fix))];
    });
    logLine(`Renamed folder ${name} → ${t}`);
    toast(`Renamed to ${t}`);
    if (path === name || path.startsWith(name + "/")) go(fix(path), false);
  };
  const deleteFolder = (name: string) => {
    const par = parentOf(name) || "General";
    update((d) => {
      d.files.forEach((f) => {
        if (f.folder === name) f.folder = par;
        else if (f.folder.startsWith(name + "/")) f.folder = par + f.folder.slice(name.length);
      });
      d.folders = d.folders.filter((f) => f !== name && !f.startsWith(name + "/"));
    });
    logLine(`Deleted folder ${name}`);
    toast(`Folder deleted — files moved to ${par}`);
    if (path === name || path.startsWith(name + "/")) go(parentOf(name), false);
  };

  const moveFolder = (name: string, target: string) => {
    const source = normFolder(name);
    const dest = normFolder(target);
    const leaf = source.split("/").pop();
    if (!source || !leaf) { toast("Select a folder to move", "err"); return false; }
    const next = dest ? `${dest}/${leaf}` : leaf;
    if (next === source) { toast("That folder is already there", "err"); return false; }
    if (next.startsWith(source + "/")) { toast("A folder cannot be moved inside itself", "err"); return false; }
    const paths = new Set<string>();
    const add = (f: string) => {
      const p = f.split("/");
      for (let i = 1; i <= p.length; i++) paths.add(p.slice(0, i).join("/"));
    };
    dbRef.current.folders.forEach(add);
    dbRef.current.files.forEach((f) => add(f.folder));
    if (paths.has(next)) { toast(`"${next}" already exists`, "err"); return false; }

    const fix = (f: string) => (f === source ? next : f.startsWith(source + "/") ? next + f.slice(source.length) : f);
    const movedFiles = dbRef.current.files.filter((f) => f.folder === source || f.folder.startsWith(source + "/"));
    update((d) => {
      d.files.forEach((f) => { f.folder = fix(f.folder); });
      d.folders = [...new Set(d.folders.map(fix))];
    });
    movedFiles.slice(0, 200).forEach((f) => {
      void learnPython(pythonSample({ name: f.name, size: f.size, folder: fix(f.folder), chat: f.chat }));
    });
    logLine(`Moved folder ${source} → ${next}`);
    toast(`Moved ${source} → ${next}`);
    clearSelection();
    if (path === source || path.startsWith(source + "/")) go(fix(path), false);
    return true;
  };

  const replaceFolders = useCallback((names: string[]) => {
    update((d) => {
      const clean = [...new Set(names.map((name) => normFolder(String(name ?? ""))).filter(Boolean))];
      d.folders = [...new Set(["General", ...clean])];
      d.log.unshift({ t: Date.now(), msg: `Restored ${d.folders.length} folders from Telegram` });
      d.log = d.log.slice(0, 80);
    });
  }, [update]);

  // ----- AI (Python first, built-in Naive Bayes as fallback)
  const pythonSample = (f: { name: string; size: number; folder: string; chat: number }): VaultPythonSample => ({
    name: f.name,
    size: f.size,
    folder: normFolder(f.folder) || "General",
    dest: `ch:${f.chat}`,
  });

  const pythonSamples = () => {
    const d = dbRef.current;
    return d.files
      .filter((f) => d.channels.some((c) => c.id === f.chat))
      .slice(-1000)
      .map(pythonSample);
  };

  const markPythonStopped = (reason: string) => {
    setPythonStatus((s) => ({ ...s, running: false, status: `Built-in model (${reason})` }));
  };

  const learnPython = async (sample: VaultPythonSample) => {
    if (!pythonApi || !pythonRef.current.running) return;
    try {
      const result = await pythonApi.learn(sample);
      setPythonStatus((s) => ({ ...s, samples: result.samples }));
    } catch (error) {
      markPythonStopped(error instanceof Error ? error.message : String(error));
    }
  };

  const trainPython = async (): Promise<VaultPythonTrainResult | null> => {
    if (!pythonApi || !pythonRef.current.running) return null;
    try {
      const result = await pythonApi.train(pythonSamples());
      setPythonStatus((s) => ({
        ...s,
        samples: result.learned,
        classes: result.classes,
        accuracy: result.accuracy,
      }));
      return result;
    } catch (error) {
      markPythonStopped(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const toBuiltInDest = (destText: string, folderText: string) => {
    const raw = String(destText || "");
    const chatText = raw.startsWith("ch:") ? raw.slice(3).split("|")[0] : raw.split("|")[0];
    const chat = Number(chatText);
    const nested = raw.includes("|") ? raw.slice(raw.indexOf("|") + 1) : "";
    return mkDest(chat, normFolder(folderText || nested) || "General");
  };

  const suggest = async (name: string, size: number, folder = ""): Promise<Prediction> => {
    const fallback = () => predict(dbRef.current.model, name, size);
    if (!pythonApi || !pythonRef.current.running) return fallback();
    try {
      const result = await pythonApi.predict({
        name,
        folder,
        size,
        allowed: dbRef.current.channels.map((c) => `ch:${c.id}`),
      });
      if (!result.top.length) return fallback();
      return {
        dest: toBuiltInDest(result.top[0].dest, result.top[0].folder),
        conf: result.top[0].p,
        top: result.top.map((t) => ({ dest: toBuiltInDest(t.dest, t.folder), p: t.p })),
      };
    } catch (error) {
      markPythonStopped(error instanceof Error ? error.message : String(error));
      return fallback();
    }
  };

  const train = async () => {
    const d0 = dbRef.current;
    const known = d0.files.filter((f) => d0.channels.some((c) => c.id === f.chat)).slice(-1000);
    const m = emptyModel();
    known.forEach((f) => learn(m, f.name, f.size, mkDest(f.chat, f.folder)));
    let ok = 0;
    known.forEach((f) => { if (predict(m, f.name, f.size).dest === mkDest(f.chat, f.folder)) ok++; });
    const acc = known.length ? Math.round((ok / known.length) * 100) : 0;
    update((d) => { d.model = m; });

    const py = await trainPython();
    if (py) {
      const score = py.accuracy == null ? "" : ` · accuracy ${Math.round(py.accuracy * 100)}%`;
      logLine(`Trained Python brain on ${py.learned} files`);
      toast(`Learned ${py.learned} files · Python engine · ${py.classes} classes${score}`);
    } else {
      logLine(`Trained brain on ${known.length} files`);
      toast(`Learned ${known.length} files · Built-in engine · ${Object.keys(m.classes).length} classes · self-check accuracy ${acc}%`);
    }
  };

  const restartAI = async () => {
    if (!pythonApi) {
      toast("Python isn't available in the browser build — using the built-in model", "err");
      return;
    }
    setBusy("Reconnecting Python...");
    try {
      const s = await pythonApi.reconnect();
      setPythonStatus(s);
      logLine(s.running ? `Python brain connected: ${s.status}` : `Python unavailable: ${s.status}`);
      toast(s.running ? s.status : `${s.status} — using built-in model`, s.running ? "ok" : "err");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markPythonStopped(message);
      toast(message, "err");
    } finally {
      setBusy("");
    }
  };

  // ----- files
  const makeBlob = async (file: File): Promise<Blob> => {
    const e = extOf(file.name);
    const b: Blob = { file };
    if (TEXT_EXT.includes(e)) b.text = (await file.slice(0, 120000).text());
    else if (MEDIA[e] && file.size <= 8 * 1024 * 1024) { b.url = URL.createObjectURL(file); b.mime = file.type; }
    return b;
  };

  const addRec: Ctx["addRec"] = async ({ name, size, folder, chat, from, file, dl, msg, fid, noLearn }) => {
    const ch = dbRef.current.channels.find((c) => c.id === chat);
    if (!ch) { toast("Channel not found — add a channel first", "err"); return null; }
    const f = normFolder(folder).slice(0, 60) || "General";
    const n = Math.max(1, Math.ceil(size / PART));
    let id = 0;
    let rec!: FileRec;
    update((d) => {
      id = d.nextId++;
      const parts = Array.from({ length: n }, (_, k) =>
        k === 0 && msg && fid
          ? { msg, fid }
          : { msg: d.nextMsg++, fid: `BQAD${id}x${k}${Math.random().toString(36).slice(2, 8)}` }
      );
      if (msg) d.nextMsg = Math.max(d.nextMsg, msg + 1);
      rec = {
        id, name, size, kind: kindOf(name), where: ch.title, folder: f, from, at: Date.now(),
        link: ch.username ? `https://t.me/${ch.username}/${parts[0].msg}` : undefined,
        chat, parts, dl: dl ?? !(from === "Bot" && size > 20_000_000),
      };
      d.files.push(rec);
      learn(d.model, name, size, mkDest(chat, f));
      d.log.unshift({ t: Date.now(), msg: `${from === "Desktop" ? "Uploaded" : from === "Bot" ? "Bot saved" : "Indexed"} ${name} → ${ch.title} / ${f}` });
    });
    if (file) blobs.current.set(id, await makeBlob(file));
    if (!noLearn) void learnPython(pythonSample({ name, size, folder: f, chat }));
    setTick((t) => t + 1);
    return rec;
  };

  const importChannel: Ctx["importChannel"] = async (info, files) => {
    update((d) => {
      const existing = d.channels.find((c) => c.id === info.id);
      if (existing) {
        existing.title = info.title;
        existing.username = info.username;
      } else {
        d.channels.push({ id: info.id, title: info.title, username: info.username });
      }
      if (!d.cfg.default_channels?.length) d.cfg.default_channels = [info.id];
    });

    const known = new Set(
      dbRef.current.files.filter((f) => f.chat === info.id).flatMap((f) => f.parts?.map((p) => p.msg) ?? [])
    );
    const fresh = files.filter((f) => !known.has(f.msg));
    for (const f of fresh) {
      await addRec({ ...f, chat: info.id, from: "Channel", dl: true, noLearn: true });
    }
    const py = await trainPython();
    if (py) logLine(`Python brain learned ${py.learned} samples from ${info.title}`);
    if (fresh.length) logLine(`Scanned ${fresh.length} item(s) in ${info.title}`);
    toast(fresh.length ? `Detected ${fresh.length} item(s) in ${info.title}` : `No new items in ${info.title}`);
    return fresh.length;
  };

  const upload: Ctx["upload"] = async (files, folder, chat) => {
    if (!dbRef.current.channels.length) { toast("Add a channel first (Channels → Add channel)", "err"); return; }
    if (!dbRef.current.bot) { toast("Connect your bot in Settings to upload", "err"); return; }

    for (const f of files) {
      let target = chat ?? dest ?? null;
      if (target == null) {
        const remembered = (dbRef.current.cfg.default_channels ?? []).filter((id) =>
          dbRef.current.channels.some((c) => c.id === id)
        );
        const predicted = (await suggest(f.name, f.size, folder)).dest;
        const predictedChat = predicted ? parseDest(predicted).chat : null;
        target =
          (predictedChat != null && remembered.includes(predictedChat) ? predictedChat : null) ??
          remembered[0] ??
          dbRef.current.channels[0].id;
      }

      const n = Math.max(1, Math.ceil(f.size / PART));
      for (let i = 1; i <= n; i++) {
        setBusy(n > 1 ? `Uploading ${f.name}.part${String(i).padStart(3, "0")} (${i}/${n})…` : `Uploading ${f.name}…`);
        await sleep(280);
      }
      const rec = await addRec({ name: f.name, size: f.size, folder: folder || "General", chat: target, from: "Desktop", file: f });
      if (rec) select(rec.id);
    }
    setBusy("");
    toast(`Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`);
  };

  const download = (id: number) => {
    const f = dbRef.current.files.find((x) => x.id === id);
    if (!f) return;
    if (!f.dl) { toast(`${f.name} was added by the bot and is over 20 MB — use /get ${f.id} in Telegram instead`, "err"); return; }
    const b = blobs.current.get(id);
    let blob: globalThis.Blob | undefined;
    if (b?.file) blob = b.file;
    else if (b?.text != null) blob = new globalThis.Blob([b.text], { type: "text/plain" });
    else if (b?.url?.startsWith("data:")) { const a = document.createElement("a"); a.href = b.url; a.download = f.name; a.click(); toast(`Downloaded ${f.name}`); return; }
    if (!blob) {
      setBusy(`Downloading ${f.name}…`);
      setTimeout(() => setBusy(""), 900);
      toast("Demo mode: content isn't kept in the browser for this file, so nothing was saved", "err");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Downloaded ${f.name}${f.parts.length > 1 ? ` (${f.parts.length} parts joined)` : ""}`);
  };
  const removeFile = (id: number) => {
    const f = dbRef.current.files.find((x) => x.id === id);
    update((d) => { d.files = d.files.filter((x) => x.id !== id); });
    blobs.current.delete(id);
    setSelectionState((s) => ({
      selected: s.selected.filter((x) => x !== id),
      focusId: s.focusId === id ? null : s.focusId,
      anchorId: s.anchorId === id ? null : s.anchorId,
    }));
    if (f) logLine(`Removed ${f.name} from the index`);
    toast("Removed from Vault");
  };
  const setHidden = (ids: number[], hidden: boolean) => {
    if (!ids.length) return;
    const set = new Set(ids);
    update((d) => { d.files.forEach((f) => { if (set.has(f.id)) f.hidden = hidden; }); });
    const label = `${ids.length} file${ids.length === 1 ? "" : "s"}`;
    logLine(`${hidden ? "Hid" : "Unhid"} ${label}`);
    toast(`${hidden ? "Hid" : "Unhid"} ${label}`);
  };
  const moveFiles = (ids: number[], folder: string) => {
    const t = normFolder(folder);
    if (!t || !ids.length) return;
    const set = new Set(ids);
    const found = dbRef.current.files.filter((f) => set.has(f.id) && f.folder !== t);
    if (!found.length) return;
    const now = Date.now();
    update((d) => {
      d.files.forEach((f) => {
        if (set.has(f.id) && f.folder !== t) {
          f.folder = t; f.at = now;
          learn(d.model, f.name, f.size, mkDest(f.chat, t));
        }
      });
    });
    found.forEach((f) => { void learnPython(pythonSample({ name: f.name, size: f.size, folder: t, chat: f.chat })); });
    const label = found.length === 1 ? found[0].name : `${found.length} files`;
    logLine(`Moved ${label} → ${t}`);
    toast(`Moved ${label} → ${t}`);
    clearSelection();
  };
  const moveFile = (id: number, folder: string) => moveFiles([id], folder);
  const openLink = (id: number) => {
    const f = dbRef.current.files.find((x) => x.id === id);
    if (f?.link?.startsWith("https://")) window.open(f.link, "_blank", "noopener");
    else toast("This channel has no public username, so there's no message link", "err");
  };

  // AI helpers live above so uploads, bot choices and moves can train immediately.

  const preview = async (id: number): Promise<Preview> => {
    await sleep(260);
    const f = dbRef.current.files.find((x) => x.id === id);
    if (!f) return { type: "note", note: "File not found." };
    const e = extOf(f.name);
    const b = blobs.current.get(id);
    const multi = f.parts.length > 1 ? "Multi-part file — previewing part 1 only." : undefined;
    const isText = TEXT_EXT.includes(e);
    const mt = MEDIA[e];
    if (!isText && !mt) return { type: "note", note: `No inline preview for .${e || "this"} files.` };
    if (!isText && f.size > 8 * 1024 * 1024) return { type: "note", note: "Too large to preview (over 8 MB)." };
    if (!b) return { type: "note", note: "Preview unavailable: Telegram's download link expired or the file isn't cached in this browser session." };
    if (isText && b.text != null) {
      const truncated = b.text.length >= 120000 || f.size > 120000;
      return { type: "text", text: b.text.slice(0, 120000), note: [truncated ? "Truncated at 120,000 characters." : "", multi].filter(Boolean).join(" ") || undefined };
    }
    if (b.url && mt) return { type: mt as "image", url: b.url, note: multi };
    return { type: "note", note: "Preview unavailable for this file." };
  };

  const openMenu: Ctx["openMenu"] = (e, items) => {
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const value: Ctx = {
    db, page, setPage, path, go, back, fwd, up, canBack: hist.i > 0, canFwd: hist.i < hist.h.length - 1,
    selId, selected, focusId, anchorId, select, setSelection, toggleSelected, clearSelection, folders, childFolders, folderCount, dest, setDest,
    theme, cycleTheme: () => setTheme((t) => (t + 1) % THEMES.length),
    busy, toast, toastMsg, menu, openMenu, closeMenu: () => setMenu(null), dialog, setDialog, botOpen, setBotOpen,
    connect, disconnect, unlock, setAuto, setDefault, addChannel, removeChannel, addFolder, renameFolder, deleteFolder, moveFolder, replaceFolders,
    upload, download, removeFile, moveFile, moveFiles, setHidden, openLink, suggest, train, restartAI, preview, addRec, importChannel, setOwner, logLine,
    python: pythonStatus, hasBlob: (id) => blobs.current.has(id), refresh: () => { setTick((t) => t + 1); toast("Refreshed"); }, tick,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export { parseDest };
