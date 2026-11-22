import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, X, Bot } from "lucide-react";
import { fmtSize, normFolder, useVault, type FileRec } from "../store";
import { parseDest } from "../brain";
import { pickFiles } from "../menus";

interface Btn { label: string; run: () => void }
interface Msg { id: number; me?: boolean; text: string; buttons?: Btn[][] }
const OWNER = 1001;
const PAGE = 6;

export function BotSim() {
  const v = useVault();
  const { db } = v;
  const dbR = useRef(db);
  dbR.current = db;
  const vR = useRef(v);
  vR.current = v;
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 0, text: "Local bot simulator. It only changes this Vault index. The real bot runs in Telegram while the desktop app is open." },
  ]);
  const [text, setText] = useState("");
  const idc = useRef(1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, v.botOpen]);

  const say = (t: string, buttons?: Btn[][], me = false) => setMsgs((m) => [...m, { id: idc.current++, text: t, buttons, me }]);
  const reply = (t: string, buttons?: Btn[][]) => setTimeout(() => say(t, buttons), 220);
  const fileLine = (f: FileRec) => `#${f.id} ${f.name} · ${fmtSize(f.size)} · ${f.where}/${f.folder}`;

  const sendFile = (f: FileRec) => {
    say(`📎 ${f.name} (${fmtSize(f.size)})`);
    f.parts.forEach((_, i) => say(`📎 ${f.name}${f.parts.length > 1 ? `.part${String(i + 1).padStart(3, "0")}` : ""}`));
  };

  const filesPage = (p: number) => {
    const list = [...dbR.current.files].sort((a, b) => b.at - a.at);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    p = Math.min(Math.max(0, p), pages - 1);
    const slice = list.slice(p * PAGE, p * PAGE + PAGE);
    const rows: Btn[][] = slice.map((f) => [
      { label: `⬇ ${f.name.slice(0, 22)}`, run: () => getFile(f.id) },
      { label: "🗑", run: () => { vR.current.removeFile(f.id); say(`🗑 Removed ${f.name}`); } },
    ]);
    const nav: Btn[] = [];
    if (p > 0) nav.push({ label: "◀ Prev", run: () => filesPage(p - 1) });
    if (p < pages - 1) nav.push({ label: "Next ▶", run: () => filesPage(p + 1) });
    if (nav.length) rows.push(nav);
    reply(list.length ? `📁 Files (page ${p + 1}/${pages})\n` + slice.map(fileLine).join("\n") : "No files yet.", rows);
  };

  const getFile = (id: number) => {
    const f = dbR.current.files.find((x) => x.id === id);
    if (!f) return reply(`No file with id ${id}.`);
    setTimeout(() => sendFile(f), 200);
  };

  const folderView = (p: string) => {
    const d = dbR.current;
    const subs = [...new Set(d.files.map((f) => f.folder).concat(d.folders).filter((f) => f && (p ? f.startsWith(p + "/") : true)).map((f) => (p ? f.slice(p.length + 1) : f).split("/")[0]))];
    const here = d.files.filter((f) => f.folder === p);
    const rows: Btn[][] = subs.map((s) => [{ label: `📂 ${s}`, run: () => folderView(p ? `${p}/${s}` : s) }]);
    here.forEach((f) => rows.push([{ label: `⬇ ${f.name.slice(0, 28)}`, run: () => getFile(f.id) }]));
    if (p) rows.push([{ label: "⬆ Up", run: () => folderView(p.split("/").slice(0, -1).join("/")) }]);
    reply(`📂 ${p || "Folders"}${here.length ? `\n${here.length} file(s)` : ""}`, rows);
  };

  const chooseChannel = () => {
    const d = dbR.current;
    if (!d.channels.length) return reply("No channels yet. Add one in the app first.");
    const remembered = d.cfg.default_channels ?? [];
    reply(
      remembered.length
        ? `Remembered channels (${remembered.length}):\n` + remembered.map((id) => d.channels.find((c) => c.id === id)?.title ?? String(id)).join("\n")
        : "Remembered channels: none. Tap one below to remember it.",
      d.channels.map((c) => [{ label: `${remembered.includes(c.id) ? "✅ " : ""}${c.title}`, run: () => { vR.current.setDefault(c.id); say(`${remembered.includes(c.id) ? "Forgot" : "Remembered"} channel: ${c.title}`); } }])
    );
  };

  const command = (raw: string) => {
    const [cmdFull, ...rest] = raw.trim().split(/\s+/);
    const cmd = cmdFull.toLowerCase().split("@")[0];
    const arg = rest.join(" ");
    const d = dbR.current;
    if (!d.bot) return reply("⚠️ No bot connected — paste a token in Settings first.");
    if (cmd === "/start" || cmd === "/help") {
      if (!d.cfg.owner) { vR.current.setOwner(OWNER); return reply("👋 You're now the owner of this Vault. Everyone else will be ignored.\n\nSend me any file, or try /help."); }
    }
    if (!d.cfg.owner) return say("(The bot ignores you — nobody has claimed it yet. Send /start.)");
    switch (cmd) {
      case "/start":
      case "/help":
        return reply("Vault commands:\n/files – browse files\n/folders – browse folders\n/channels, /default – remembered channel\n/storage – counts & sizes\n/auto – toggle learned auto-save\n/find <text> – search\n/list – plain list\n/get <id> – send a file back\n\nSend a file with a caption (≤30 chars) to pick its folder.");
      case "/files": return filesPage(0);
      case "/folders": return folderView("");
      case "/channels":
      case "/default": return chooseChannel();
      case "/storage":
        return reply("💾 Storage\n" + (d.channels.map((c) => { const f = d.files.filter((x) => x.chat === c.id); return `${c.title}: ${f.length} files · ${fmtSize(f.reduce((a, x) => a + x.size, 0))}`; }).join("\n") || "No channels"));
      case "/auto":
        vR.current.setAuto(!d.cfg.auto);
        return reply(`Auto-save is now ${!d.cfg.auto ? "ON ✅" : "OFF"}.`);
      case "/find": {
        if (!arg) return reply("Usage: /find <text>");
        const q = arg.toLowerCase();
        const r = d.files.filter((f) => f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q)).slice(0, 8);
        return reply(r.length ? `🔎 ${r.length} result(s)\n` + r.map(fileLine).join("\n") : "Nothing found.", r.map((f) => [{ label: `⬇ ${f.name.slice(0, 30)}`, run: () => getFile(f.id) }]));
      }
      case "/list":
        return reply(d.files.length ? d.files.map(fileLine).join("\n") : "No files yet.");
      case "/get": {
        const id = Number(arg.replace("#", ""));
        return id ? getFile(id) : reply("Usage: /get <id>");
      }
      default: return reply("Unknown command. Try /help.");
    }
  };

  const incoming = async (file: File, caption: string) => {
    const d = dbR.current;
    say(`📎 ${file.name} · ${fmtSize(file.size)}${caption ? `\n“${caption}”` : ""}`, undefined, true);
    if (!d.bot) return reply("⚠️ No bot connected — paste a token in Settings first.");
    if (!d.cfg.owner) return say("(The bot ignores you — send /start first.)");
    if (!d.channels.length) return reply("I have no channel to save into. Add a channel in the app first.");
    const capFolder = caption.trim().length > 0 && caption.trim().length <= 30 ? normFolder(caption) : "";
    const pred = await vR.current.suggest(file.name, file.size, capFolder);
    const save = async (chat: number, folder: string, how: string) => {
      const rec = await vR.current.addRec({ name: file.name, size: file.size, folder, chat, from: "Bot", file });
      if (rec) say(`🧪 Simulated save ${how}\n${rec.where} / ${rec.folder}\nNothing was posted to Telegram by this simulator.${rec.dl ? "" : "\n⚠ Over 20 MB: use /get " + rec.id + " in the real bot."}`);
    };
    const learned = vR.current.python.running ? vR.current.python.samples : d.model.n;
    if (d.cfg.auto && pred.dest && pred.conf >= 0.7 && learned >= 3) {
      const p = parseDest(pred.dest);
      if (d.channels.some((c) => c.id === p.chat)) {
        reply(`🧠 Confident (${Math.round(pred.conf * 100)}%) — auto-saving.`);
        return void setTimeout(() => save(p.chat, capFolder || p.folder, "automatically"), 400);
      }
    }
    const remembered = (d.cfg.default_channels ?? []).filter((id) => d.channels.some((c) => c.id === id));
    if (remembered.length) {
      const predictedChat = pred.dest ? parseDest(pred.dest).chat : null;
      const chosen = predictedChat && remembered.includes(predictedChat) ? predictedChat : remembered[0];
      const folder = capFolder || (pred.dest ? parseDest(pred.dest).folder : "General");
      return void setTimeout(() => save(chosen, folder, "to a remembered channel"), 300);
    }
    const folder = capFolder || (pred.dest ? parseDest(pred.dest).folder : "General");
    reply(
      `Where should I save ${file.name}?${pred.dest ? `\n🧠 Best guess: ${Math.round(pred.conf * 100)}%` : ""}`,
      d.channels.map((c) => [{ label: `${c.title} / ${folder}`, run: () => { save(c.id, folder, "(you chose — the AI learned)"); } }])
    );
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    say(t, undefined, true);
    if (t.startsWith("/")) command(t);
    else reply("I only understand commands and files. Try /help.");
  };

  const attach = () => pickFiles((fs) => { const cap = text.trim(); setText(""); fs.forEach((f) => incoming(f, cap)); });

  return (
    <div className={`absolute bottom-7 right-0 top-12 z-30 flex w-[360px] flex-col border-l border-line bg-panel shadow-2xl shadow-black/40 ${v.botOpen ? "" : "hidden"}`}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accentfg"><Bot size={18} /></div>
        <div className="flex-1">
          <div className="font-semibold">{db.bot ? `@${db.bot.username}` : "No bot"}</div>
          <div className="text-[11px] text-ok">simulator · local index</div>
        </div>
        <button onClick={() => v.setBotOpen(false)} className="text-muted hover:text-fg"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-bg/60 p-3">
        {msgs.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.me ? "items-end" : "items-start"}`}>
            <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 ${m.me ? "rounded-br-sm bg-accent text-accentfg" : "rounded-bl-sm bg-panel2"}`}>{m.text}</div>
            {m.buttons && (
              <div className="mt-1 w-[88%] space-y-1">
                {m.buttons.map((row, i) => (
                  <div key={i} className="flex gap-1">
                    {row.map((b, j) => (
                      <button key={j} onClick={b.run} className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] hover:border-accent">{b.label}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="flex flex-wrap gap-1 border-t border-line px-3 pt-2">
        {["/start", "/files", "/folders", "/storage", "/auto", "/channels"].map((c) => (
          <button key={c} onClick={() => { say(c, undefined, true); command(c); }} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-fg">{c}</button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 p-3">
        <button onClick={attach} title="Send a file (the text box becomes its caption)" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-panel2 hover:border-accent"><Paperclip size={15} /></button>
        <input
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Message or caption…" className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5"
        />
        <button onClick={submit} className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent text-accentfg"><Send size={15} /></button>
      </div>
    </div>
  );
}
