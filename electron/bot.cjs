const API = "https://api.telegram.org/bot";
const FILE_API = "https://api.telegram.org/file/bot";
const PART = 19 * 1024 * 1024;
const POLL_TIMEOUT = 25;

function shortError(error) {
  const message = error?.message || String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normFolder(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/")
    .slice(0, 60);
}

function parseDest(value) {
  const raw = String(value || "");
  if (!raw.startsWith("ch:")) return null;
  const split = raw.indexOf("|");
  const chat = Number(raw.slice(3, split < 0 ? undefined : split));
  if (!Number.isFinite(chat)) return null;
  return { chat, folder: normFolder(split < 0 ? "" : raw.slice(split + 1)) || "General" };
}

function mediaOf(message) {
  const doc =
    message.document ||
    message.audio?.document ||
    message.video?.document ||
    message.voice?.document ||
    (message.media?.document ? message.media.document : null);
  if (doc) {
    const named = doc.attributes?.find((a) => a?.file_name || a?.fileName);
    const fallback = message.voice
      ? `voice_${message.message_id}.ogg`
      : message.audio
        ? `audio_${message.message_id}.mp3`
        : message.video
          ? `video_${message.message_id}.mp4`
          : `file_${message.message_id}`;
    return {
      fileId: doc.file_id,
      name: named?.file_name || named?.fileName || fallback,
      size: Number(doc.file_size || 0),
      mime: doc.mime_type || "application/octet-stream",
    };
  }
  if (message.photo) {
    const sizes = message.photo.sizes || [];
    const largest = sizes[sizes.length - 1];
    return {
      fileId: message.photo.file_id,
      name: `photo_${message.message_id}.jpg`,
      size: Number(largest?.file_size || 0),
      mime: "image/jpeg",
    };
  }
  return null;
}

function fileLine(file) {
  const where = file.where ? `${file.where} / ` : "";
  return `#${file.id} ${file.name} · ${formatSize(file.size)} · ${where}${file.folder}`;
}

function formatSize(size) {
  let n = Number(size || 0);
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function splitName(name) {
  const value = String(name || "file");
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return { base: value, ext: "" };
  return { base: value.slice(0, dot), ext: value.slice(dot) };
}

class VaultBot {
  constructor(ipcMain, getWindow) {
    this.ipcMain = ipcMain;
    this.getWindow = getWindow;
    this.state = {};
    this.token = "";
    this.offset = 0;
    this.stopped = true;
    this.lastError = "";
    this.eventId = 0;
    this.pendingEvents = new Map();
    this.jobs = new Map();
  }

  register() {
    this.ipcMain.handle("bot:connect", (_, token) => this.validate(String(token || "").trim()));
    this.ipcMain.handle("bot:status", () => this.status());
    this.ipcMain.handle("bot:setState", (_, state) => this.setState(state));
    this.ipcMain.on("bot:event-result", (_, result) => {
      const pending = this.pendingEvents.get(result?.id);
      if (!pending) return;
      this.pendingEvents.delete(result.id);
      if (result?.ok) pending.resolve(result.result);
      else pending.reject(new Error(result?.error || "Renderer failed"));
    });
  }

  status() {
    return {
      running: !!this.token && !this.stopped,
      tokenSet: !!this.token,
      username: this.state.botUsername || "",
      lastError: this.lastError,
    };
  }

  async validate(token) {
    if (!token) return { ok: false, error: "Enter a bot token first." };
    try {
      const data = await this.api(token, "getMe", {}, 15000);
      return { ok: true, username: data.result?.username || `bot${String(data.result?.id || "")}` };
    } catch (error) {
      return { ok: false, error: shortError(error) };
    }
  }

  setState(state) {
    this.state = state || {};
    const token = String(this.state.token || "").trim();
    if (token === this.token) return this.status();
    this.stop();
    this.token = token;
    this.offset = 0;
    this.lastError = "";
    if (token) this.start();
    return this.status();
  }

  stop() {
    this.stopped = true;
  }

  start() {
    this.stopped = false;
    this.poll().catch((error) => {
      if (this.stopped) return;
      this.lastError = shortError(error);
      void this.log(`Bot stopped: ${this.lastError}`);
    });
  }

  async api(token, method, body = {}, timeout = 35000) {
    if (!token) throw new Error("No bot token set.");
    const response = await fetch(`${API}${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const data = await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }));
    if (!data.ok) throw new Error(data.description || `${method} failed`);
    return data;
  }

  async sendText(chat, text, markup) {
    const body = { chat_id: chat, text: String(text).slice(0, 4000) };
    if (markup) body.reply_markup = markup;
    return this.api(this.token, "sendMessage", body);
  }

  async answerCallback(id, text) {
    try {
      await this.api(this.token, "answerCallbackQuery", { callback_query_id: id, text: text || undefined }, 10000);
    } catch {}
  }

  ask(type, payload, timeout = 10000) {
    const id = ++this.eventId;
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return Promise.reject(new Error("Vault window is not ready."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingEvents.delete(id);
        reject(new Error(`Renderer did not answer ${type}`));
      }, timeout);
      this.pendingEvents.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      win.webContents.send("bot:event", { id, type, payload });
    });
  }

  async log(message) {
    try {
      await this.ask("log", { msg: String(message).slice(0, 300) }, 3000);
    } catch {}
  }

  async poll() {
    while (!this.stopped) {
      try {
        const data = await this.api(
          this.token,
          "getUpdates",
          { offset: this.offset, timeout: POLL_TIMEOUT },
          (POLL_TIMEOUT + 10) * 1000
        );
        for (const update of data.result || []) {
          if (this.stopped) return;
          this.offset = Math.max(this.offset, Number(update.update_id || 0) + 1);
          try {
            await this.handleUpdate(update);
          } catch (error) {
            await this.log(`Bot update failed: ${shortError(error)}`);
          }
        }
      } catch (error) {
        if (this.stopped) return;
        this.lastError = shortError(error);
        await this.log(`Bot polling error: ${this.lastError}`);
        await delay(4000);
      }
    }
  }

  async handleUpdate(update) {
    if (update.callback_query) return this.handleCallback(update.callback_query);
    const message = update.message;
    if (!message || message.chat?.type !== "private") return;
    const from = Number(message.from?.id || 0);
    if (!from) return;

    if (message.text) return this.handleCommand(message, from);
    const media = mediaOf(message);
    if (media) return this.handleFile(message, media, from);
    await this.sendText(message.chat.id, "Send a file with an optional folder caption, or type /help.");
  }

  async claim(from) {
    if (this.state.owner == null) {
      let owner = from;
      try {
        const result = await this.ask("claim", { owner: from }, 5000);
        if (Number(result?.owner)) owner = Number(result.owner);
      } catch {}
      this.state.owner = owner;
      return { ok: true, claimed: true };
    }
    return { ok: Number(this.state.owner) === from, claimed: false };
  }

  async handleCommand(message, from) {
    const chat = message.chat.id;
    const [raw, ...rest] = String(message.text || "").trim().split(/\s+/);
    const command = raw.toLowerCase().split("@")[0];
    const arg = rest.join(" ");

    if (command === "/start" || command === "/help") {
      const claim = await this.claim(from);
      if (!claim.ok) return this.sendText(chat, "This bot is already claimed by another account.");
      return this.sendText(
        chat,
        claim.claimed
          ? "👋 You're now the owner of this Vault. Everyone else will be ignored.\n\nSend me any file, or try /help."
          : "Vault commands:\n/files – browse files\n/folders – browse folders\n/channels, /default – remembered channel\n/storage – counts & sizes\n/auto – toggle learned auto-save\n/find <text> – search\n/list – plain list\n/get <id> – send a file back\n\nSend a file with a caption (≤30 chars) to pick its folder."
      );
    }
    if (!this.state.owner || Number(this.state.owner) !== from) {
      return this.sendText(chat, "Send /start first so I know who you are.");
    }

    const files = this.state.files || [];
    switch (command) {
      case "/files":
      case "/list": {
        const list = [...files].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
        if (!list.length) return this.sendText(chat, "No files yet.");
        const rows = list.slice(0, 6).map((file) => [
          { text: `⬇ ${String(file.name).slice(0, 22)}`, callback_data: `get:${file.id}` },
          { text: "🗑", callback_data: `del:${file.id}` },
        ]);
        const text = command === "/list" ? list.map(fileLine).join("\n") : `📁 Files (${list.length})\n` + list.slice(0, 6).map(fileLine).join("\n");
        return this.sendText(chat, text.slice(0, 4000), { inline_keyboard: rows });
      }
      case "/folders": {
        const set = new Set();
        for (const file of files) {
          const parts = String(file.folder || "").split("/");
          for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
        }
        (this.state.folders || []).forEach((folder) => set.add(folder));
        const list = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
        return this.sendText(chat, list.length ? `📂 ${list.join("\n📂 ")}` : "No folders yet.");
      }
      case "/channels":
      case "/default": {
        const remembered = this.state.defaultChannels || [];
        const lines = (this.state.channels || []).map((channel) => `${remembered.includes(channel.id) ? "✅ " : ""}${channel.title}`);
        return this.sendText(chat, lines.length ? `Channels:\n${lines.join("\n")}` : "No channels yet. Add one in the app first.");
      }
      case "/storage": {
        const lines = (this.state.channels || []).map((channel) => {
          const own = files.filter((file) => Number(file.chat) === Number(channel.id));
          return `${channel.title}: ${own.length} files · ${formatSize(own.reduce((sum, file) => sum + Number(file.size || 0), 0))}`;
        });
        return this.sendText(chat, lines.length ? `💾 Storage\n${lines.join("\n")}` : "No channels yet.");
      }
      case "/find": {
        if (!arg) return this.sendText(chat, "Usage: /find <text>");
        const query = arg.toLowerCase();
        const found = files.filter((file) => String(file.name).toLowerCase().includes(query) || String(file.folder).toLowerCase().includes(query)).slice(0, 6);
        if (!found.length) return this.sendText(chat, "Nothing found.");
        const rows = found.map((file) => [{ text: `⬇ ${String(file.name).slice(0, 28)}`, callback_data: `get:${file.id}` }]);
        return this.sendText(chat, `🔎 ${found.length} result(s)\n${found.map(fileLine).join("\n")}`, { inline_keyboard: rows });
      }
      case "/auto": {
        const next = !this.state.auto;
        try {
          await this.ask("auto", { auto: next }, 5000);
          this.state.auto = next;
        } catch {}
        return this.sendText(chat, `Auto-save is now ${next ? "ON ✅" : "OFF"}.`);
      }
      case "/get": {
        const id = Number(String(arg).replace("#", ""));
        const file = id ? files.find((entry) => Number(entry.id) === id) : null;
        if (!file) return this.sendText(chat, id ? `No file with id ${id}.` : "Usage: /get <id>");
        const fid = file.parts?.[0]?.fid;
        if (!fid) return this.sendText(chat, "That file has no Telegram file ID.");
        try {
          await this.sendByFileId(chat, fid, file.name, `${fileLine(file)}\nVault #${file.id}`);
        } catch (error) {
          return this.sendText(chat, `Couldn't send it: ${shortError(error)}`);
        }
        return undefined;
      }
      default:
        return this.sendText(chat, "Unknown command. Try /help.");
    }
  }

  async handleCallback(query) {
    const id = query.id;
    const data = String(query.data || "");
    const [tag, a, b] = data.split(":");
    await this.answerCallback(id);
    const chat = query.message?.chat?.id;
    if (!chat) return;

    if (tag === "get") {
      const file = (this.state.files || []).find((entry) => Number(entry.id) === Number(a));
      const fid = file?.parts?.[0]?.fid;
      if (!fid) return this.sendText(chat, "That file is no longer available.");
      try {
        await this.sendByFileId(chat, fid, file.name, `${fileLine(file)}\nVault #${file.id}`);
      } catch (error) {
        await this.sendText(chat, `Couldn't send it: ${shortError(error)}`);
      }
      return;
    }
    if (tag === "del") {
      try {
        await this.ask("remove", { id: Number(a) }, 5000);
        await this.sendText(chat, `🗑 Removed #${a}`);
      } catch {
        await this.sendText(chat, "Couldn't remove that file.");
      }
      return;
    }
    if (tag === "sv") {
      const job = this.jobs.get(a);
      this.jobs.delete(a);
      if (!job) return this.sendText(chat, "That save request expired. Send the file again.");
      await this.saveMedia({ ...job, chat: Number(b), userChat: chat });
    }
  }

  async handleFile(message, media, from) {
    const chat = message.chat.id;
    if (!this.state.owner || Number(this.state.owner) !== from) {
      return this.sendText(chat, "Send /start first so I know who you are.");
    }
    const channels = this.state.channels || [];
    if (!channels.length) return this.sendText(chat, "I have no channel to save into. Add one in the app first.");

    const caption = normFolder(message.caption);
    await this.sendText(chat, "Saving…");

    let prediction = null;
    try {
      prediction = await this.ask("decision", { name: media.name, size: media.size, folder: caption }, 8000);
    } catch {}

    const guess = prediction?.dest ? parseDest(prediction.dest) : null;
    const guessChat = guess && channels.some((channel) => Number(channel.id) === guess.chat) ? guess.chat : null;
    const folder = caption || guess?.folder || "General";
    const remembered = (this.state.defaultChannels || []).filter((id) => channels.some((channel) => Number(channel.id) === id));
    const learned = Number(this.state.pythonSamples || 0);
    const confident = !!guessChat && Number(prediction?.conf || 0) >= 0.7 && learned >= 3;

    if (this.state.auto && confident) {
      return this.saveMedia({ ...media, folder, chat: guessChat, userChat: chat });
    }
    if (remembered.length) {
      const target = guessChat && remembered.includes(guessChat) ? guessChat : remembered[0];
      return this.saveMedia({ ...media, folder, chat: target, userChat: chat });
    }
    if (guessChat) {
      return this.saveMedia({ ...media, folder, chat: guessChat, userChat: chat });
    }
    if (channels.length === 1) {
      return this.saveMedia({ ...media, folder, chat: channels[0].id, userChat: chat });
    }

    const jobId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.jobs.set(jobId, { fileId: media.fileId, name: media.name, size: media.size, mime: media.mime, folder });
    const markup = {
      inline_keyboard: channels.map((channel) => [
        { text: String(channel.title).slice(0, 60), callback_data: `sv:${jobId}:${channel.id}` },
      ]),
    };
    return this.sendText(chat, `Where should I save ${media.name}?\n📂 ${folder}`, markup);
  }

  async downloadFile(fileId) {
    const info = await this.api(this.token, "getFile", { file_id: fileId }, 20000);
    const filePath = info.result?.file_path;
    if (!filePath) throw new Error("Telegram did not return a file path.");
    const response = await fetch(`${FILE_API}${this.token}/${filePath}`, {
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`File download failed (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  async sendDocument(chat, bytes, filename, mime, caption) {
    const form = new FormData();
    form.append("chat_id", String(chat));
    if (caption) form.append("caption", String(caption).slice(0, 1000));
    form.append("document", new Blob([new Uint8Array(bytes)], { type: mime || "application/octet-stream" }), filename);
    const response = await fetch(`${API}${this.token}/sendDocument`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(180000),
    });
    const data = await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }));
    if (!data.ok) throw new Error(data.description || "sendDocument failed");
    return {
      msg: Number(data.result?.message_id || 0),
      fid: String(data.result?.document?.file_id || data.result?.video?.file_id || data.result?.audio?.file_id || ""),
    };
  }

  async sendByFileId(chat, fileId, filename, caption) {
    const data = await this.api(
      this.token,
      "sendDocument",
      { chat_id: chat, document: fileId, caption: String(caption || filename).slice(0, 1000) },
      30000
    );
    return Number(data.result?.message_id || 0);
  }

  async saveMedia(job) {
    const chat = job.chat;
    const userChat = job.userChat;
    const channel = (this.state.channels || []).find((entry) => Number(entry.id) === Number(chat));
    const channelTitle = channel?.title || String(chat);
    try {
      const bytes = await this.downloadFile(job.fileId);
      const size = Number(job.size || bytes.length);
      const count = Math.max(1, Math.ceil(bytes.length / PART));
      const { base, ext } = splitName(job.name);
      const parts = [];
      for (let i = 0; i < count; i++) {
        const name = count === 1 ? job.name : `${base}.part${String(i + 1).padStart(3, "0")}${ext}`;
        const caption = i === 0 ? `📂 ${job.folder}` : undefined;
        const sent = await this.sendDocument(chat, bytes.subarray(i * PART, (i + 1) * PART), name, job.mime, caption);
        if (sent.msg && sent.fid) parts.push(sent);
      }
      if (!parts.length) throw new Error("Telegram did not return message IDs.");

      let id = null;
      try {
        const result = await this.ask(
          "saved",
          { name: job.name, size, folder: job.folder, chat: Number(chat), parts },
          10000
        );
        id = result?.id ?? null;
      } catch {}

      await this.sendText(
        userChat,
        `✅ Saved${id ? ` #${id}` : ""} in ${channelTitle} / ${job.folder}${size > 20 * 1024 * 1024 ? "\n⚠ Over 20 MB: use /get to receive it back" : ""}`
      );
      await this.log(`Bot saved ${job.name} → ${channelTitle} / ${job.folder}`);
    } catch (error) {
      await this.sendText(userChat, `⚠️ Could not save ${job.name}: ${shortError(error)}`);
      await this.log(`Bot save failed: ${shortError(error)}`);
    }
  }
}

function registerBotIpc(ipcMain, getWindow) {
  const bot = new VaultBot(ipcMain, getWindow);
  bot.register();
  return bot;
}

module.exports = { registerBotIpc, VaultBot };
