import { useEffect, useRef, useState } from "react";
import { Bot, Brain, KeyRound, Lock, RefreshCw, Sparkles, Download, RotateCcw, Check } from "lucide-react";
import { useVault } from "../store";
import { Btn, inputCls } from "../ui";
import { Card } from "./Overview";

const Row = ({ title, desc, children }: { title: string; desc?: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <div><div className="font-medium">{title}</div>{desc && <div className="text-[12px] text-muted">{desc}</div>}</div>
    <div className="shrink-0">{children}</div>
  </div>
);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const emptyTelegram: VaultTelegramSettings = {
  apiId: "", phone: "", channels: [], autoPush: true, hasSession: false, user: null, lastSyncAt: 0,
};

export function SettingsPage() {
  const v = useVault();
  const { db } = v;
  const [token, setToken] = useState("");
  const [tg, setTg] = useState<VaultTelegramSettings>(emptyTelegram);
  const [tgHash, setTgHash] = useState("");
  const [tgChannelText, setTgChannelText] = useState("");
  const [need, setNeed] = useState<"code" | "password" | null>(null);
  const [answer, setAnswer] = useState("");
  const [tgBusy, setTgBusy] = useState("");
  const [tgReady, setTgReady] = useState(false);
  const lastAutoPush = useRef("");
  const tgApi = window.vaultDesktop?.telegram;

  useEffect(() => {
    const api = window.vaultDesktop?.telegram;
    if (!api) return;
    api.getSettings().then((settings) => {
      setTg((old) => ({ ...old, ...settings }));
      setTgChannelText((settings.channels ?? []).join(", "));
      setTgReady(true);
    }).catch(() => setTgReady(true));
    const off = api.onNeed((kind) => { setNeed(kind); setAnswer(""); });
    return off;
  }, []);

  useEffect(() => {
    if (!tgApi || !tgReady || !tg.hasSession || !tg.autoPush || !tg.channels.length) return;
    const key = v.folders.join("\n");
    if (!key || key === lastAutoPush.current) return;
    lastAutoPush.current = key;
    const timer = window.setTimeout(() => {
      tgApi.pushFolders(tg.channels, v.folders).catch(() => {});
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [v.folders, tgReady, tg.hasSession, tg.autoPush, tg.channels, tgApi]);

  const currentChannels = () => tgChannelText.split(",").map((x) => x.trim()).filter(Boolean);

  const persistTg = async () => {
    if (!tgApi) return null;
    const channels = currentChannels();
    setTg((s) => ({ ...s, channels }));
    return tgApi.saveSettings({
      apiId: tg.apiId,
      apiHash: tgHash || undefined,
      phone: tg.phone,
      channels,
      autoPush: tg.autoPush,
    });
  };

  const tgLogin = async () => {
    if (!tgApi) return;
    setTgBusy("Signing in…");
    try {
      const result = await tgApi.login({ apiId: tg.apiId, apiHash: tgHash, phone: tg.phone });
      setTg(result);
      await persistTg();
      setNeed(null);
      v.toast(`Telegram connected as ${result.user?.username || result.user?.firstName || result.user?.id}`);
    } catch (error) {
      v.toast(errText(error), "err");
    } finally {
      setTgBusy("");
    }
  };

  const tgSubmit = async () => {
    if (!tgApi || !need || !answer.trim()) return;
    setTgBusy("Checking…");
    try {
      await tgApi.submit(need, answer.trim());
      setNeed(null);
      setAnswer("");
    } catch (error) {
      v.toast(errText(error), "err");
    } finally {
      setTgBusy("");
    }
  };

  const tgPush = async () => {
    if (!tgApi) return;
    setTgBusy("Saving folders…");
    try {
      await persistTg();
      const result = await tgApi.pushFolders(currentChannels(), v.folders);
      lastAutoPush.current = v.folders.join("\n");
      v.toast(result.unchanged ? "Folder structure is already saved" : `Saved ${result.folders} folders to Telegram`);
    } catch (error) {
      v.toast(errText(error), "err");
    } finally {
      setTgBusy("");
    }
  };

  const tgPull = async () => {
    if (!tgApi) return;
    setTgBusy("Restoring folders…");
    try {
      await persistTg();
      const result = await tgApi.pullFolders(currentChannels());
      v.replaceFolders(result.folders);
      lastAutoPush.current = result.folders.join("\n");
      v.toast(`Restored ${result.folders.length} folders from Telegram`);
    } catch (error) {
      v.toast(errText(error), "err");
    } finally {
      setTgBusy("");
    }
  };

  const tgLogout = async () => {
    if (!tgApi) return;
    setTgBusy("Signing out…");
    try { setTg(await tgApi.logout()); }
    catch (error) { v.toast(errText(error), "err"); }
    finally { setTgBusy(""); }
  };

  const exportIndex = () => {
    const { cfg, ...rest } = db;
    const blob = new Blob([JSON.stringify({ cfg: { ...cfg, token: cfg.token ? "<hidden>" : "" }, ...rest }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "vault.json"; a.click();
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <h1 className="text-xl font-semibold">Settings</h1>

        <Card title={<span className="flex items-center gap-1.5"><KeyRound size={13} /> Telegram bot</span>}>
          {db.bot ? (
            <Row title={`@${db.bot.username}`} desc="Token saved locally and never shown again.">
              <div className="flex items-center gap-2"><span className="flex items-center gap-1 text-ok"><Check size={14} /> Connected</span><Btn danger onClick={v.disconnect}>Disconnect</Btn></div>
            </Row>
          ) : (
            <>
              <div className="mb-2 text-muted">Create a bot with @BotFather and paste its token.</div>
              <div className="flex gap-2">
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AAE…" className={inputCls} autoComplete="off" />
                <Btn primary disabled={!token.trim()} onClick={async () => { if (await v.connect(token)) setToken(""); }}><Bot size={14} /> Connect</Btn>
              </div>
            </>
          )}
          <div className="mt-2 border-t border-line pt-2">
            <Row title="Bot owner" desc={db.cfg.owner ? `Locked to Telegram user ${db.cfg.owner}. Everyone else is ignored.` : "Unclaimed — the first person to send /start becomes the owner."}>
              <Btn onClick={v.unlock} disabled={!db.cfg.owner}><Lock size={13} /> Unlock</Btn>
            </Row>
            <Row title="Learned auto-save" desc="Save bot files automatically when confidence ≥ 70% and at least 3 files are learned.">
              <button
                onClick={() => v.setAuto(!db.cfg.auto)}
                className={`relative h-6 w-11 rounded-full transition ${db.cfg.auto ? "bg-accent" : "bg-panel2 border border-line"}`}
                role="switch" aria-checked={db.cfg.auto}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${db.cfg.auto ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </Row>
            <Row title="Remembered channels" desc="Fallback destinations when the AI is unsure. Select as many as you want.">
              <div className="flex max-w-[420px] flex-wrap justify-end gap-1">
                {db.channels.length === 0 && <span className="text-[12px] text-muted">No channels yet</span>}
                {db.channels.map((c) => {
                  const on = (db.cfg.default_channels ?? []).includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => v.setDefault(c.id)}
                      className={`rounded-full border px-2 py-1 text-[12px] ${on ? "border-accent bg-accent/10 text-fg" : "border-line text-muted hover:border-accent"}`}
                    >
                      {on ? "✓ " : ""}{c.title}
                    </button>
                  );
                })}
              </div>
            </Row>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Bot size={13} /> Telegram folder sync</span>}>
          {!tgApi ? (
            <div className="text-[12px] text-muted">Desktop only. Build and run the Electron app to sync folders with Telegram.</div>
          ) : (
            <>
              <div className="text-[12px] text-muted">
                Sign in with your Telegram user account, then choose one or more channels. Vault saves the folder tree there, so another device can restore it. Adding a channel also scans its existing items. Files and downloads still use the simulator.
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <input value={tg.apiId} onChange={(e) => setTg((s) => ({ ...s, apiId: e.target.value }))} placeholder="API ID" className={inputCls} />
                <input value={tgHash} onChange={(e) => setTgHash(e.target.value)} type="password" placeholder="API hash" className={inputCls} autoComplete="off" />
                <input value={tg.phone} onChange={(e) => setTg((s) => ({ ...s, phone: e.target.value }))} placeholder="Phone (+…)" className={inputCls} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Btn primary disabled={!tg.apiId || !tg.phone || !!tgBusy} onClick={tgLogin}>Sign in</Btn>
                {tg.hasSession && <span className="flex items-center gap-1 text-ok"><Check size={14} /> {tg.user?.username ? `@${tg.user.username}` : tg.user?.firstName || "Connected"}</span>}
                {tg.hasSession && <Btn danger disabled={!!tgBusy} onClick={tgLogout}>Sign out</Btn>}
                {tgBusy && <span className="text-[12px] text-muted">{tgBusy}</span>}
              </div>
              {need && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void tgSubmit()}
                    type={need === "password" ? "password" : "text"}
                    placeholder={need === "code" ? "Telegram login code" : "Two-step password"}
                    className={inputCls}
                    autoFocus
                  />
                  <Btn onClick={tgSubmit} disabled={!answer.trim() || !!tgBusy}>Send</Btn>
                </div>
              )}
              <div className="mt-3 border-t border-line pt-2">
                <Row title="Sync channels" desc={tg.lastSyncAt ? `Last saved ${new Date(tg.lastSyncAt).toLocaleString()}` : "Separate multiple channels with commas."}>
                  <input
                    value={tgChannelText}
                    onChange={(e) => {
                      const text = e.target.value;
                      setTgChannelText(text);
                      setTg((s) => ({ ...s, channels: text.split(",").map((x) => x.trim()).filter(Boolean) }));
                    }}
                    placeholder="@channel1, @channel2, -1001234567890"
                    className={`${inputCls} max-w-[320px]`}
                  />
                </Row>
                <Row title="Auto-save folders" desc="Send the folder tree to Telegram whenever it changes.">
                  <button
                    onClick={() => { const next = !tg.autoPush; setTg((s) => ({ ...s, autoPush: next })); void tgApi.saveSettings({ autoPush: next }); }}
                    className={`relative h-6 w-11 rounded-full transition ${tg.autoPush ? "bg-accent" : "bg-panel2 border border-line"}`}
                    role="switch" aria-checked={tg.autoPush}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${tg.autoPush ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </Row>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Btn disabled={!tg.hasSession || !tg.channels.length || !!tgBusy} onClick={tgPush}>Save folders to channels</Btn>
                  <Btn primary disabled={!tg.hasSession || !tg.channels.length || !!tgBusy} onClick={tgPull}>Restore folders from channels</Btn>
                </div>
                <div className="mt-2 text-[12px] text-muted">Get API ID and hash from my.telegram.org → API development tools.</div>
              </div>
            </>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Brain size={13} /> AI engine</span>}>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Engine", v.python.running ? "Python" : "Built-in"],
              ["Learned files", v.python.running ? v.python.samples : db.model.n],
              ["Classes", v.python.running ? v.python.classes : Object.keys(db.model.classes).length],
            ].map(([k, val]) => (
              <div key={k} className="rounded-lg bg-panel2 p-3"><div className="text-lg font-semibold">{val}</div><div className="text-[12px] text-muted">{k}</div></div>
            ))}
          </div>
          <div className={`mt-2 text-[12px] ${v.python.running ? "text-ok" : "text-muted"}`} title={v.python.status}>
            {v.python.status}
            {v.python.running && v.python.accuracy != null ? ` · accuracy ${Math.round(v.python.accuracy * 100)}%` : ""}
          </div>
          <p className="mt-3 text-[12px] text-muted">
            The desktop app runs <code>model/vault_model.py</code> (scikit-learn) and falls back to the built-in Naive Bayes model if Python is missing.
            It predicts a channel + folder from filename, type, size and captions, and never reads file content.
          </p>
          <div className="mt-3 flex gap-2">
            <Btn primary onClick={v.train}><Sparkles size={14} /> Train</Btn>
            <Btn onClick={v.restartAI}><RefreshCw size={14} /> Reconnect Python</Btn>
          </div>
        </Card>

        <Card title="Local data">
          <Row title="Export index" desc="Downloads vault.json (bot token is hidden).">
            <Btn onClick={exportIndex}><Download size={14} /> Export</Btn>
          </Row>
          <Row title="Clear local data" desc="Remove everything you added in this browser and start with an empty Vault.">
            <Btn danger onClick={() => v.setDialog({ type: "confirm", title: "Clear Vault", text: "This removes your local files, channels and settings in this browser.", ok: "Clear", onOk: () => { localStorage.removeItem("vault.json"); localStorage.removeItem("vault.examplesCleared"); location.reload(); } })}><RotateCcw size={14} /> Clear</Btn>
          </Row>
        </Card>
      </div>
    </div>
  );
}
