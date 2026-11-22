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
