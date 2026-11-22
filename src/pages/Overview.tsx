import { Files, Radio, Folder, HardDrive, Activity } from "lucide-react";
import { fmtDate, fmtSize, useVault } from "../store";
import { KindIcon } from "../ui";

export const Card = ({ title, children, className = "" }: { title: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`rounded-xl border border-line bg-panel ${className}`}>
    <div className="border-b border-line px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-muted">{title}</div>
    <div className="p-4">{children}</div>
  </section>
);

export function OverviewPage() {
  const v = useVault();
  const { db } = v;
  const total = db.files.reduce((a, f) => a + f.size, 0);
  const recent = [...db.files].sort((a, b) => b.at - a.at).slice(0, 7);
  const stats = [
    [Files, "Files", db.files.length],
    [Radio, "Channels", db.channels.length],
    [Folder, "Folders", v.folders.length],
    [HardDrive, "Stored in Telegram", fmtSize(total)],
  ] as const;
  const per = db.channels.map((c) => ({ c, n: db.files.filter((f) => f.chat === c.id).length, s: db.files.filter((f) => f.chat === c.id).reduce((a, f) => a + f.size, 0) }));
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-muted">Your files live as messages in Telegram channels. Vault keeps only the index.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(([Icon, label, val]) => (
            <div key={label} className="rounded-xl border border-line bg-panel p-4">
              <Icon size={18} className="mb-3 text-accent" />
              <div className="text-2xl font-semibold">{val}</div>
              <div className="text-muted">{label}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Recent files">
            {recent.length === 0 && <div className="text-muted">Nothing here yet.</div>}
            <div className="-my-1 divide-y divide-line/60">
              {recent.map((f) => (
                <button key={f.id} onClick={() => { v.go(f.folder); v.select(f.id); }} className="flex w-full items-center gap-3 py-2 text-left hover:text-accent">
                  <KindIcon kind={f.kind} name={f.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{f.name}</span>
                    <span className="block truncate text-[11px] text-muted">{f.where} / {f.folder}</span>
                  </span>
                  <span className="text-[11px] text-muted">{fmtSize(f.size)}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card title={<span className="flex items-center gap-1.5"><Activity size={13} /> Activity</span>}>
            <div className="max-h-80 space-y-2.5 overflow-auto">
              {db.log.slice(0, 20).map((l, i) => (
                <div key={i} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <div><div>{l.msg}</div><div className="text-[11px] text-muted">{fmtDate(l.t)}</div></div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <Card title="Storage per channel">
          <div className="space-y-3">
            {per.length === 0 && <div className="text-muted">No channels yet.</div>}
            {per.map(({ c, n, s }) => (
              <div key={c.id}>
                <div className="mb-1 flex justify-between"><span>{c.title}</span><span className="text-muted">{n} files · {fmtSize(s)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-accent" style={{ width: `${total ? Math.max(3, (s / total) * 100) : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
