// Built-in "brain": Naive Bayes over classes like "ch:123456789|Work/Invoices".
// Features: file kind, extension, size bucket, words from the filename.

export interface Model {
  n: number;
  classes: Record<string, number>;
  feats: Record<string, Record<string, number>>;
  tot: Record<string, number>;
  vocab: Record<string, number>;
}

export const emptyModel = (): Model => ({ n: 0, classes: {}, feats: {}, tot: {}, vocab: {} });

export const extOf = (name: string) => {
  const m = /\.([a-z0-9]+)$/i.exec(name.replace(/\.part\d+$/i, ""));
  return m ? m[1].toLowerCase() : "";
};

const EXT: Record<string, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"],
  video: ["mp4", "mkv", "mov", "avi", "webm"],
  audio: ["mp3", "wav", "flac", "ogg", "m4a"],
  doc: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "epub"],
  text: ["txt", "md", "csv", "json", "xml", "yaml", "yml", "toml", "log", "sql", "ini"],
  code: ["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "sh", "bat", "html", "css", "rb", "php"],
  archive: ["zip", "rar", "7z", "tar", "gz"],
};

export const kindOf = (name: string) => {
  const e = extOf(name);
  for (const k in EXT) if (EXT[k].includes(e)) return k;
  return "file";
};

const bucket = (s: number) => (s < 10_000 ? "tiny" : s < 1_000_000 ? "small" : s < 20_000_000 ? "medium" : "large");

export const feats = (name: string, size: number) => {
  const base = name.replace(/\.part\d+$/i, "");
  const f = [`k:${kindOf(base)}`, `e:${extOf(base)}`, `s:${bucket(size)}`];
  base
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w))
    .forEach((w) => f.push(`w:${w}`));
  return f;
};

export function learn(m: Model, name: string, size: number, dest: string) {
  m.n++;
  m.classes[dest] = (m.classes[dest] || 0) + 1;
  const t = (m.feats[dest] ||= {});
  for (const f of feats(name, size)) {
    t[f] = (t[f] || 0) + 1;
    m.tot[dest] = (m.tot[dest] || 0) + 1;
    m.vocab[f] = 1;
  }
}

export interface Prediction {
  dest: string | null;
  conf: number;
  top: { dest: string; p: number }[];
}

export function predict(m: Model, name: string, size: number): Prediction {
  const cls = Object.keys(m.classes);
  if (!cls.length) return { dest: null, conf: 0, top: [] };
  const V = Object.keys(m.vocab).length + 1;
  const fs = feats(name, size);
  const lp = cls.map((c) => {
    let s = Math.log(m.classes[c] / m.n);
    for (const f of fs) s += Math.log(((m.feats[c][f] || 0) + 0.5) / ((m.tot[c] || 0) + 0.5 * V));
    return s;
  });
  const mx = Math.max(...lp);
  const ex = lp.map((x) => Math.exp(x - mx));
  const sum = ex.reduce((a, b) => a + b, 0);
  const top = cls.map((c, i) => ({ dest: c, p: ex[i] / sum })).sort((a, b) => b.p - a.p);
  return { dest: top[0].dest, conf: top[0].p, top: top.slice(0, 3) };
}

export const parseDest = (d: string) => {
  const i = d.indexOf("|");
  return { chat: Number(d.slice(3, i)), folder: d.slice(i + 1) };
};
export const mkDest = (chat: number, folder: string) => `ch:${chat}|${folder}`;
