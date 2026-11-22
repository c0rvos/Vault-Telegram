const fs = require("fs");
const path = require("path");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const MARKER = "VAULT_FOLDERS_V1";
const CHUNK_SIZE = 3500;

function normalizeFolders(folders) {
  const seen = new Set();
  for (const raw of folders ?? []) {
    const name = String(raw ?? "")
      .replace(/\\/g, "/")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("/");
    if (name) seen.add(name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function normalizeChannels(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  for (const item of list) {
    const channel = String(item ?? "").trim();
    if (channel) seen.add(channel);
  }
  return [...seen];
}

function folderSignature(channels, folders) {
  return JSON.stringify({ channels: normalizeChannels(channels), folders: normalizeFolders(folders) });
}

function chunkText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks.length ? chunks : [""];
}

function channelRef(input) {
  const value = String(input ?? "").trim();
  if (!value) throw new Error("Enter a channel username or ID first.");
  if (/^-?\d+$/.test(value)) {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new Error("That channel ID is too large.");
    return n > 0 && String(n).length >= 9 ? -1000000000000 - n : n;
  }
  return value.startsWith("@") ? value : `@${value}`;
}

function latestCompleteGroup(messages) {
  const groups = new Map();
  for (const msg of messages) {
    const match = /^VAULT_FOLDERS_V1 ([a-z0-9]+) (\d+)\/(\d+)\n([\s\S]*)$/.exec(msg.message || "");
    if (!match) continue;
    const [, batch, indexText, totalText, body] = match;
    const index = Number(indexText);
    const total = Number(totalText);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) continue;
    const group = groups.get(batch) || { total, chunks: [], latest: 0 };
    if (group.total !== total) continue;
    group.chunks[index] = body;
    group.latest = Math.max(group.latest, msg.id || 0);
    groups.set(batch, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.chunks.filter((chunk) => typeof chunk === "string").length === group.total)
    .sort((a, b) => b[1].latest - a[1].latest)[0]?.[1] || null;
}

function mediaInfo(msg) {
  const doc =
    msg.document ||
    msg.audio?.document ||
    msg.video?.document ||
    msg.voice?.document ||
    (msg.media?.document ? msg.media.document : null);
  if (doc) {
    const named = doc.attributes?.find((a) => a?.fileName);
    const name =
      named?.fileName ||
      (msg.voice ? `voice_${msg.id}.ogg` : msg.audio ? `audio_${msg.id}.mp3` : msg.video ? `video_${msg.id}.mp4` : `file_${msg.id}`);
    return { name, size: Number(doc.size || 0), fid: String(doc.id) };
  }
  if (msg.photo) {
    const sizes = msg.photo.sizes || [];
    const largest = sizes[sizes.length - 1];
    return { name: `photo_${msg.id}.jpg`, size: Number(largest?.size || 0), fid: String(msg.photo.id) };
  }
  return null;
}

function captionFolder(caption) {
  const text = String(caption || "").trim();
  if (!text || text.startsWith("VAULT_FOLDERS_V1")) return "General";
  return text.replace(/\\/g, "/").slice(0, 60) || "General";
}

function shortError(error) {
  const message = error?.message || String(error);
  return message.length > 400 ? `${message.slice(0, 400)}…` : message;
}

class TelegramSync {
  constructor(app, ipcMain, getWindow) {
    this.app = app;
    this.getWindow = getWindow;
    this.file = path.join(app.getPath("userData"), "vault-telegram.json");
    this.settings = this.load();
    this.client = null;
    this.pending = {};
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!Array.isArray(data.channels)) data.channels = data.channel ? [data.channel] : [];
      delete data.channel;
      return data;
    } catch {
      return { channels: [] };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.settings, null, 2));
  }

  publicSettings() {
    const channels = this.settings.channels || [];
    return {
      apiId: this.settings.apiId ? String(this.settings.apiId) : "",
      phone: this.settings.phone || "",
      channels,
      channel: channels[0] || "",
      autoPush: this.settings.autoPush !== false,
      hasSession: !!this.settings.session,
      user: this.settings.user || null,
      lastSyncAt: this.settings.lastSyncAt || 0,
    };
  }

  saveSettings(patch) {
    if (patch?.apiId !== undefined) this.settings.apiId = String(patch.apiId).trim();
    if (patch?.apiHash) this.settings.apiHash = String(patch.apiHash).trim();
    if (patch?.phone !== undefined) this.settings.phone = String(patch.phone).trim();
    if (patch?.channels !== undefined) this.settings.channels = normalizeChannels(patch.channels);
    else if (patch?.channel !== undefined) this.settings.channels = normalizeChannels([patch.channel]);
    if (typeof patch?.autoPush === "boolean") this.settings.autoPush = patch.autoPush;
    this.save();
    return this.publicSettings();
  }

  rejectPending(error) {
    for (const item of Object.values(this.pending)) item?.reject?.(error);
    this.pending = {};
  }

  resolvePending(kind, value) {
    const item = this.pending[kind];
    if (!item) return false;
    delete this.pending[kind];
    item.resolve(value);
    return true;
  }

  ask(kind) {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) throw new Error("The Vault window is not ready.");
    return new Promise((resolve, reject) => {
      this.pending[kind] = { resolve, reject };
      win.webContents.send("telegram:need", kind);
    });
  }

  async getClient() {
    if (!this.settings.apiId || !this.settings.apiHash) {
      throw new Error("Enter your Telegram API ID and hash first.");
    }
    if (this.client?.connected) return this.client;

    const session = new StringSession(this.settings.session || "");
    this.client = new TelegramClient(
      session,
      Number(this.settings.apiId),
      this.settings.apiHash,
      { connectionRetries: 3 }
    );
    await this.client.connect();
    return this.client;
  }

  async login(input) {
    this.rejectPending(new Error("A new Telegram sign-in was started."));
    this.saveSettings(input);

    const apiId = Number(this.settings.apiId);
    const apiHash = this.settings.apiHash;
    const phone = this.settings.phone;
    if (!Number.isInteger(apiId) || !apiHash || !phone) {
      throw new Error("API ID, API hash and phone number are all required.");
    }

    const client = await this.getClient();
    try {
      await client.start({
        phoneNumber: async () => phone,
        phoneCode: async () => this.ask("code"),
        password: async () => this.ask("password"),
        onError: (error) => console.error("[telegram]", error),
      });

      const me = await client.getMe();
      this.settings.session = client.session.save();
      this.settings.user = {
        id: Number(me.id),
        firstName: me.firstName || "",
        username: me.username || "",
      };
      this.save();
      return { ok: true, ...this.publicSettings() };
    } catch (error) {
      this.rejectPending(error);
      throw new Error(shortError(error));
    }
  }

  async logout() {
    try {
      const client = await this.getClient();
      await client.disconnect();
    } catch {}
    this.client = null;
    delete this.settings.session;
    delete this.settings.user;
    delete this.settings.lastSyncAt;
    this.save();
    return this.publicSettings();
  }

  async pushFolders(channelInput, folders) {
    const channels = normalizeChannels(channelInput);
    if (!channels.length) throw new Error("Enter at least one sync channel.");
    const foldersList = normalizeFolders(folders);
    const signature = folderSignature(channels, foldersList);
    if (signature === this.settings.lastFolderSignature) {
      return { ok: true, unchanged: true, folders: foldersList.length, messages: 0, channels };
    }

    const client = await this.getClient();
    if (!this.settings.session) throw new Error("Sign in to Telegram first.");

    let messages = 0;
    for (const channel of channels) {
      const entity = await client.getEntity(channelRef(channel));
      const payload = JSON.stringify({ v: 1, folders: foldersList, at: Date.now() });
      const chunks = chunkText(payload, CHUNK_SIZE);
      const batch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      for (let i = 0; i < chunks.length; i++) {
        await client.sendMessage(entity, {
          message: `${MARKER} ${batch} ${i + 1}/${chunks.length}\n${chunks[i]}`,
        });
      }
      messages += chunks.length;
    }

    this.settings.channels = channels;
    this.settings.lastFolderSignature = signature;
    this.settings.lastSyncAt = Date.now();
    this.save();
    return { ok: true, unchanged: false, folders: foldersList.length, messages, channels };
  }

  async pullFolders(channelInput) {
    const channels = normalizeChannels(channelInput);
    if (!channels.length) throw new Error("Enter at least one sync channel.");

    const client = await this.getClient();
    if (!this.settings.session) throw new Error("Sign in to Telegram first.");

    const found = new Set();
    let latestAt = 0;
    let channelsFound = 0;
    for (const channel of channels) {
      const entity = await client.getEntity(channelRef(channel));
      const messages = await client.getMessages(entity, { limit: 200 });
      const group = latestCompleteGroup(messages);
      if (!group) continue;
      const parsed = JSON.parse(group.chunks.join(""));
      if (parsed?.v !== 1 || !Array.isArray(parsed.folders)) continue;
      for (const folder of normalizeFolders(parsed.folders)) found.add(folder);
      latestAt = Math.max(latestAt, parsed.at || 0);
      channelsFound++;
    }

    if (!channelsFound) throw new Error("No saved folder structure found in those channels yet.");
    const folders = [...found].sort((a, b) => a.localeCompare(b));
    this.settings.channels = channels;
    this.settings.lastFolderSignature = folderSignature(channels, folders);
    this.settings.lastSyncAt = latestAt || Date.now();
    this.save();
    return { ok: true, folders, at: this.settings.lastSyncAt, channels };
  }

  async scanChannel(channelInput) {
    const channel = String(channelInput ?? "").trim();
    if (!channel) throw new Error("Enter a channel username or ID first.");

    const client = await this.getClient();
    if (!this.settings.session) throw new Error("Sign in to Telegram first.");
    const entity = await client.getEntity(channelRef(channel));
    const messages = await client.getMessages(entity, { limit: 500 });
    const seen = new Set();
    const files = [];

    for (const msg of messages) {
      if (!msg?.id || seen.has(msg.id)) continue;
      const media = mediaInfo(msg);
      if (!media) continue;
      seen.add(msg.id);
      files.push({
        name: media.name,
        size: media.size,
        folder: captionFolder(msg.message),
        msg: Number(msg.id),
        fid: media.fid,
      });
    }

    return {
      ok: true,
      channel: {
        id: Number(entity.id),
        title: entity.title || channel.replace(/^@/, ""),
        username: entity.username || undefined,
        files,
      },
    };
  }

  register() {
    const ipcMain = this.ipcMain;
    ipcMain.handle("telegram:settings:get", () => this.publicSettings());
    ipcMain.handle("telegram:settings:save", (_, patch) => this.saveSettings(patch));
    ipcMain.handle("telegram:login", (_, input) => this.login(input));
    ipcMain.handle("telegram:submit", (_, { kind, value }) => this.resolvePending(kind, value));
    ipcMain.handle("telegram:logout", () => this.logout());
    ipcMain.handle("telegram:pushFolders", (_, { channels, folders }) =>
      this.pushFolders(channels, folders)
    );
    ipcMain.handle("telegram:pullFolders", (_, { channels }) => this.pullFolders(channels));
    ipcMain.handle("telegram:scanChannel", (_, { channel }) => this.scanChannel(channel));
  }
}

function registerTelegramIpc(app, ipcMain, getWindow) {
  const sync = new TelegramSync(app, ipcMain, getWindow);
  sync.ipcMain = ipcMain;
  sync.register();
  return sync;
}

module.exports = { registerTelegramIpc };
