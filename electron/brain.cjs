const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

class PythonBrain {
  constructor(app) {
    this.app = app;
    this.child = null;
    this.pending = new Map();
    this.next = 1;
    this.buffer = "";
    this.samples = 0;
    this.classes = 0;
    this.accuracy = null;
    this.status = "Built-in model (Python not started)";
  }

  scriptPath() {
    const candidates = [];
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, "app.asar.unpacked", "model", "vault_model.py"));
    }
    candidates.push(path.join(this.app.getAppPath(), "model", "vault_model.py"));
    candidates.push(path.join(__dirname, "..", "model", "vault_model.py"));
    return candidates.find((file) => fs.existsSync(file)) || null;
  }

  publicStatus() {
    return {
      status: this.status,
      running: this.running(),
      samples: this.samples,
      classes: this.classes,
      accuracy: this.accuracy,
    };
  }

  running() {
    return !!this.child && !this.child.killed && this.status.startsWith("Python engine");
  }

  stop() {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("AI engine stopped"));
    }
    this.pending.clear();
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.buffer = "";
  }

  call(op, payload = {}, timeout = 60000) {
    if (!this.child || this.child.killed) return Promise.reject(new Error("AI engine is not running"));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("AI engine timed out"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      const request = JSON.stringify({ id, op, ...payload }) + "\n";
      this.child.stdin.write(request, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  attach(io) {
    this.child = io;
    this.buffer = "";
    io.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        let response;
        try { response = JSON.parse(line); } catch { continue; }
        const item = this.pending.get(response.id);
        if (!item) continue;
        clearTimeout(item.timer);
        this.pending.delete(response.id);
        if (response.ok) item.resolve(response);
        else item.reject(new Error(response.error || "AI error"));
      }
    });
    io.on("exit", () => this.stop());
  }

  async start() {
    this.stop();
    this.classes = 0;
    this.accuracy = null;
    const script = this.scriptPath();
    if (!script) {
      this.status = "Built-in model (model/vault_model.py not found)";
      return this.publicStatus();
    }

    const data = path.join(this.app.getPath("userData"), "ai");
    fs.mkdirSync(data, { recursive: true });
    const programs = process.platform === "win32" ? ["py", "python"] : ["python3", "python"];
    let last = "Python not found";

    for (const program of programs) {
      let child;
      try {
        child = spawn(program, [script, "--data", data], {
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        });
      } catch (error) {
        last = error.message;
        continue;
      }
      this.attach(child);
      try {
        const hello = await this.call("hello", {}, 15000);
        this.samples = Number(hello.samples || 0);
        this.status = `Python engine (scikit-learn ${hello.sklearn || "?"})`;
        return this.publicStatus();
      } catch (error) {
        last = error.message;
        this.stop();
      }
    }

    this.status = `Built-in model (${last})`;
    return this.publicStatus();
  }

  async reconnect() {
    return this.start();
  }

  async train(samples) {
    const result = await this.call("train", { samples: samples || [] }, 120000);
    this.samples = Number(result.learned || this.samples);
    this.classes = Number(result.classes || 0);
    this.accuracy = result.accuracy == null ? null : Number(result.accuracy);
    return {
      learned: this.samples,
      classes: this.classes,
      accuracy: this.accuracy,
      engine: "python",
    };
  }

  async predict(request) {
    const result = await this.call("predict", {
      name: String(request?.name || ""),
      folder: String(request?.folder || ""),
      size: Number(request?.size || 0),
      allowed: Array.isArray(request?.allowed) ? request.allowed : [],
    });
    return { top: Array.isArray(result.top) ? result.top : [] };
  }

  async learn(sample) {
    const result = await this.call("learn", { sample });
    this.samples = Number(result.samples || this.samples);
    return { samples: this.samples };
  }
}

function registerBrainIpc(ipcMain, brain) {
  ipcMain.handle("python:status", () => brain.publicStatus());
  ipcMain.handle("python:reconnect", () => brain.reconnect());
  ipcMain.handle("python:train", (_, { samples }) => brain.train(samples));
  ipcMain.handle("python:predict", (_, request) => brain.predict(request));
  ipcMain.handle("python:learn", (_, { sample }) => brain.learn(sample));
}

module.exports = { PythonBrain, registerBrainIpc };
