import { useState } from "react";
import { Plus, Radio, Star, Trash2, Send } from "lucide-react";
import { fmtSize, useVault, type Channel } from "../store";
import { Btn, inputCls } from "../ui";
import { Card } from "./Overview";
import { pickFiles } from "../menus";

export function ChannelsPage() {
  const v = useVault();
  const { db } = v;
  const [input, setInput] = useState("");
  const [scanning, setScanning] = useState(false);

  const scanRef = async (ref: string) => {
    const api = window.vaultDesktop?.telegram;
    if (!api) { v.toast("Desktop only — open the Electron app to detect channel items", "err"); return; }
    setScanning(true);
    try {
      const result = await api.scanChannel(ref);
      await v.importChannel(result.channel, result.channel.files);
    } catch (error) {
      v.toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setScanning(false);
    }
  };

  const add = async () => {
    const ref = input.trim();
    if (!v.addChannel(ref)) return;
    setInput("");
    const api = window.vaultDesktop?.telegram;
    if (!api) return;
    try {
      const settings = await api.getSettings();
      if (settings.hasSession) await scanRef(ref);
    } catch {}
  };

  const simulatePost = (c: Channel) =>
    pickFiles((fs) =>
      v.setDialog({
        type: "prompt", title: `Post in ${c.title}`, label: "Caption (becomes the folder, max 30 chars)", value: "General", ok: "Post",
        onOk: async (cap) => {
          for (const f of fs) await v.addRec({ name: f.name, size: f.size, folder: cap.slice(0, 30), chat: c.id, from: "Channel", file: f });
          v.toast(`Bot indexed ${fs.length} file${fs.length > 1 ? "s" : ""} posted in ${c.title}`);
        },
      })
    );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Channels</h1>
          <p className="text-muted">Telegram channels where your files are stored. The bot must be an administrator of each one.</p>
        </div>
        <Card title="Add channel">
          <div className="flex gap-2">
            <input
              value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="@my_channel or -1001234567890" className={inputCls}
            />
            <Btn primary onClick={add} disabled={!input.trim()}><Plus size={14} /> Add</Btn>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            In the desktop app, sign in under Settings → Telegram folder sync first. Adding a channel then scans it for existing items automatically.
          </p>
        </Card>

        <div className="space-y-3">
          {db.channels.length === 0 && (
            <div className="rounded-xl border border-dashed border-line p-10 text-center text-muted">
              <Radio size={30} className="mx-auto mb-2 opacity-60" />
              No channels yet. Create a Telegram channel, add your bot as admin, then add it above.
            </div>
          )}
          {db.channels.map((c) => {
            const fs = db.files.filter((f) => f.chat === c.id);
            const def = (db.cfg.default_channels ?? []).includes(c.id);
            return (
              <div key={c.id} className={`flex items-center gap-4 rounded-xl border bg-panel p-4 ${def ? "border-accent" : "border-line"}`}>
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/15 text-accent"><Radio size={20} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-semibold">
                    {c.title}
                    {def && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accentfg">REMEMBERED</span>}
                  </div>
                  <div className="truncate text-muted">{c.username ? `@${c.username} · ` : ""}{c.id}</div>
                  <div className="text-[12px] text-muted">{fs.length} files · {fmtSize(fs.reduce((a, f) => a + f.size, 0))}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Btn onClick={() => scanRef(c.username ? `@${c.username}` : String(c.id))} disabled={scanning} title="Scan real Telegram messages and index their files">{scanning ? "Detecting…" : "Detect items"}</Btn>
                  <Btn onClick={() => simulatePost(c)} title="Simulate someone posting a file directly into the channel"><Send size={13} /> Simulate post</Btn>
                  <Btn onClick={() => v.setDefault(c.id)}><Star size={13} fill={def ? "currentColor" : "none"} /> {def ? "Forget" : "Remember"}</Btn>
                  <Btn danger onClick={() => v.setDialog({ type: "confirm", title: "Forget channel", text: `Forget "${c.title}"? Its files stay in the index but can't be re-uploaded to.`, ok: "Forget", onOk: () => v.removeChannel(c.id) })}><Trash2 size={13} /></Btn>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
