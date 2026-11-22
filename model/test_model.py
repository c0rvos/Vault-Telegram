"""Quick self-test: python test_model.py  (simulates what the Vault app sends)."""
import json, subprocess, sys, tempfile
from pathlib import Path
SCRIPT = Path(__file__).with_name("vault_model.py")
p = subprocess.Popen([sys.executable, str(SCRIPT), "--data", tempfile.mkdtemp()], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
def call(**r):
    p.stdin.write(json.dumps(r) + "\n"); p.stdin.flush(); return json.loads(p.stdout.readline())
S = lambda n, s, f, d="ch:1": {"name": n, "size": s, "folder": f, "dest": d}
data = [S(f"IMG_2024{m:02d}{d:02d}_{d}.jpg", 3e6, "photos") for m in range(1, 5) for d in (3, 9, 17)]
data += [S(f"invoice_{m}_acme.pdf", 2e5, "Work/Invoices") for m in ("jan", "feb", "mar", "apr", "may")]
data += [S(f"{t}.mp3", 5e6, "music", "ch:2") for t in ("lofi_mix", "road_trip", "gym_playlist", "night_drive")]
data += [S(f"notes_week{w}.txt", 2e3, "General") for w in range(1, 5)]
print(call(op="hello")); print(call(op="train", samples=data))
for name, size, folder in [("IMG_20250214_88.jpg", 2.8e6, ""), ("invoice_jun_acme.pdf", 1.9e5, ""), ("summer_mix.mp3", 4e6, ""), ("random.bin", 9e8, ""), ("report.pdf", 1e5, "photos")]:
    t = call(op="predict", name=name, size=size, folder=folder, allowed=["ch:1", "ch:2"])["top"][0]; print(f"{name:24} -> {t['dest']}|{t['folder']}  {t['p']:.0%}")
print(call(op="learn", sample=S("receipt_aug.pdf", 1e5, "Work/Invoices"))); print(call(op="predict", name="x.zip", size=1, folder="", allowed=["ch:9"]))
p.stdin.close()
