import { emptyModel } from "./brain";
import type { Db, Blob } from "./store";

// The app starts with an empty Vault. Add channels, files and settings yourself.
export function makeSeed(): { db: Db; blobs: Map<number, Blob> } {
  const db: Db = {
    cfg: { token: "", owner: null, auto: true, default_channels: [] },
    channels: [],
    files: [],
    log: [],
    folders: ["General"],
    model: emptyModel(),
    nextId: 1,
    nextMsg: 1,
    bot: null,
  };
  return { db, blobs: new Map() };
}
