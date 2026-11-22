#!/usr/bin/env python3
"""Vault brain: learns where you put files and suggests a channel + folder.
The Vault app starts this script and talks to it with one JSON message per line (stdin/stdout)."""
import argparse, json, re, sys, warnings
from collections import Counter
from pathlib import Path
warnings.filterwarnings("ignore")

KINDS = {"image": "jpg jpeg png gif webp bmp svg heic tif", "video": "mp4 mkv mov avi webm", "audio": "mp3 m4a aac ogg wav flac opus",
         "doc": "pdf doc docx xls xlsx ppt pptx odt txt md csv rtf", "archive": "zip rar 7z tar gz", "code": "rs py js ts java c cpp go html css json sh bat"}
KIND_OF = {e: k for k, v in KINDS.items() for e in v.split()}

def features(name, size):
    """Turn a file name + size into a bag of tokens (extension, kind, size class, name words, name shape)."""
    p = Path(name); ext = p.suffix.lower().lstrip("."); stem = p.stem.lower()
    words = [w for w in re.split(r"[^a-z0-9]+", stem) if len(w) > 2][:12]
    shape = re.sub(r"[0-9]+", "0", re.sub(r"[a-z]+", "a", stem))[:12]
    bucket = "tiny" if size < 1e6 else "small" if size < 2e7 else "medium" if size < 1e8 else "large"
    toks = [f"ext_{ext}" if ext else "", f"kind_{KIND_OF.get(ext, 'other')}", f"size_{bucket}", f"shape_{shape}"] + [f"w_{w}" for w in words]
    return " ".join(t for t in toks if t)

def clean(s):
    return {"name": str(s["name"]), "size": int(s.get("size") or 0), "dest": str(s["dest"]), "folder": (s.get("folder") or "").strip() or "General"}

def make_model():
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import FeatureUnion, Pipeline
    feats = FeatureUnion([
        ("word", TfidfVectorizer(token_pattern=r"\S+", sublinear_tf=True)),
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True)),  # sub-word clues like "inv" in "invoice"
    ])
    return Pipeline([("f", feats), ("c", LogisticRegression(C=10, max_iter=500))])

class Brain:
    def __init__(self, data):
        self.dir = Path(data); self.dir.mkdir(parents=True, exist_ok=True); self.file = self.dir / "ai_samples.jsonl"
        self.samples, self.model, self.counts, self.dirty = [], None, Counter(), True
        if self.file.exists():
            for line in self.file.read_text(encoding="utf-8").splitlines():
                try: self.samples.append(clean(json.loads(line)))
                except Exception: pass
        self.samples = self.samples[-5000:]

    def save(self):
        self.file.write_text("\n".join(json.dumps(s) for s in self.samples), encoding="utf-8")

    def label(self, s): return f"{s['dest']}|{s['folder']}"

    def fit(self):
        self.dirty = False; y = [self.label(s) for s in self.samples]; self.counts = Counter(y); self.model = None
        if len(self.counts) >= 2:
            self.model = make_model().fit([features(s["name"], s["size"]) for s in self.samples], y)

    def accuracy(self):
        """Cross-validated accuracy, or None when there is too little data to measure it."""
        y = [self.label(s) for s in self.samples]; c = Counter(y)
        keep = [i for i, l in enumerate(y) if c[l] >= 2]
        if len(keep) < 6 or len({y[i] for i in keep}) < 2: return None
        yk = [y[i] for i in keep]; k = min(5, min(Counter(yk).values()))
        if k < 2: return None
        from sklearn.model_selection import cross_val_score
        return float(cross_val_score(make_model(), [features(self.samples[i]["name"], self.samples[i]["size"]) for i in keep], yk, cv=k).mean())

    def predict(self, name, folder, size, allowed):
        if self.dirty: self.fit()
        if not self.counts: return []
        if self.model is None:                       # only one place used so far: confidence grows with evidence
            n = sum(self.counts.values()); probs = {next(iter(self.counts)): n / (n + 2)}
        else:
            probs = dict(zip(self.model.classes_, self.model.predict_proba([features(name, size)])[0]))
        probs = {k: v for k, v in probs.items() if not allowed or k.split("|", 1)[0] in allowed}
        want = (folder or "").strip().lower()        # a caption on the file narrows the choice to that folder
        if want and want != "general":
            hit = {k: v for k, v in probs.items() if k.split("|", 1)[1].lower() == want or k.split("|", 1)[1].lower().startswith(want + "/")}
            probs = hit or probs
        total = sum(probs.values())
        if self.model is not None and total: probs = {k: v / total for k, v in probs.items()}
        return [{"dest": k.split("|", 1)[0], "folder": k.split("|", 1)[1], "p": v} for k, v in sorted(probs.items(), key=lambda kv: -kv[1])[:3]]

    def handle(self, r):
        op = r.get("op")
        if op == "hello":
            import sklearn
            return {"engine": "python", "sklearn": sklearn.__version__, "samples": len(self.samples)}
        if op == "learn":
            self.samples.append(clean(r["sample"])); self.samples = self.samples[-5000:]; self.dirty = True; self.save()
            return {"samples": len(self.samples)}
        if op == "train":
            self.samples = [clean(s) for s in r.get("samples", [])][-5000:]; self.save(); self.fit()
            return {"learned": len(self.samples), "classes": len(self.counts), "accuracy": self.accuracy() if self.model else None}
        if op == "predict":
            return {"top": self.predict(r.get("name", ""), r.get("folder", ""), int(r.get("size") or 0), r.get("allowed") or [])}
        raise ValueError(f"unknown op {op!r}")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", default="."); brain = Brain(ap.parse_args().data)
    for line in sys.stdin:
        if not line.strip(): continue
        req = {}
        try:
            req = json.loads(line); out = {"id": req.get("id"), "ok": True, **brain.handle(req)}
        except ImportError:
            out = {"id": req.get("id"), "ok": False, "error": "scikit-learn is not installed. Run: pip install scikit-learn"}
        except Exception as e:
            out = {"id": req.get("id"), "ok": False, "error": str(e)}
        sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()

if __name__ == "__main__":
    main()
