const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const { registerTelegramIpc } = require("./telegram.cjs");
const { registerBotIpc } = require("./bot.cjs");
const { PythonBrain, registerBrainIpc } = require("./brain.cjs");

let mainWindow;
let brain;
const devUrl = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_START_URL;

// Fixes blank windows on some Windows GPU drivers.
app.disableHardwareAcceleration();

function getIconPath() {
  const icon =
    process.platform === "win32"
      ? "icon.ico"
      : process.platform === "darwin"
        ? "icon.icns"
        : "icon.png";
  return path.join(__dirname, "..", "build", icon);
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
}

function registerWindowIpc() {
  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window:toggleMaximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window:close", () => {
    mainWindow?.close();
  });
  ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 840,
    minHeight: 560,
    frame: false,
    title: "Vault",
    backgroundColor: "#0d111a",
    icon: getIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:maximized", false));

  // Keep links in the system browser instead of opening app windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (/^https?:\/\//i.test(url) && url !== devUrl) {
      event.preventDefault();
      openExternal(url);
    }
  });

  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const indexFile = path.join(__dirname, "..", "dist", "index.html");
    mainWindow.loadFile(indexFile).catch(() => {
      dialog.showErrorBox(
        "Vault",
        "The app build is missing. Run npm run build first."
      );
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  brain = new PythonBrain(app);
  registerBrainIpc(ipcMain, brain);
  registerTelegramIpc(app, ipcMain, () => mainWindow);
  registerBotIpc(ipcMain, () => mainWindow);
  registerWindowIpc();
  await brain.start();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  brain?.stop();
});
