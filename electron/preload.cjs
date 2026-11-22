const { contextBridge, ipcRenderer } = require("electron");

const needHandlers = new Set();

ipcRenderer.on("telegram:need", (_, kind) => {
  for (const handler of needHandlers) handler(kind);
});

contextBridge.exposeInMainWorld("vaultDesktop", {
  telegram: {
    getSettings: () => ipcRenderer.invoke("telegram:settings:get"),
    saveSettings: (patch) => ipcRenderer.invoke("telegram:settings:save", patch),
    login: (input) => ipcRenderer.invoke("telegram:login", input),
    submit: (kind, value) => ipcRenderer.invoke("telegram:submit", { kind, value }),
    logout: () => ipcRenderer.invoke("telegram:logout"),
    pushFolders: (channels, folders) =>
      ipcRenderer.invoke("telegram:pushFolders", { channels, folders }),
    pullFolders: (channels) => ipcRenderer.invoke("telegram:pullFolders", { channels }),
    scanChannel: (channel) => ipcRenderer.invoke("telegram:scanChannel", { channel }),
    onNeed: (handler) => {
      needHandlers.add(handler);
      return () => needHandlers.delete(handler);
    },
  },
  bot: {
    connect: (token) => ipcRenderer.invoke("bot:connect", token),
    status: () => ipcRenderer.invoke("bot:status"),
    setState: (state) => ipcRenderer.invoke("bot:setState", state),
    onEvent: (handler) => {
      const listener = async (_, event) => {
        try {
          const result = await handler(event.type, event.payload);
          ipcRenderer.send("bot:event-result", { id: event.id, ok: true, result });
        } catch (error) {
          ipcRenderer.send("bot:event-result", {
            id: event.id,
            ok: false,
            error: error?.message || String(error),
          });
        }
      };
      ipcRenderer.on("bot:event", listener);
      return () => ipcRenderer.removeListener("bot:event", listener);
    },
  },
  python: {
    status: () => ipcRenderer.invoke("python:status"),
    reconnect: () => ipcRenderer.invoke("python:reconnect"),
    train: (samples) => ipcRenderer.invoke("python:train", { samples }),
    predict: (request) => ipcRenderer.invoke("python:predict", request),
    learn: (sample) => ipcRenderer.invoke("python:learn", { sample }),
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    onMaximized: (handler) => {
      const listener = (_, value) => handler(value);
      ipcRenderer.on("window:maximized", listener);
      return () => ipcRenderer.removeListener("window:maximized", listener);
    },
  },
});
