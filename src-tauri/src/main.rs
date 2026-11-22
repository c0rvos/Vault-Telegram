#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use futures_util::StreamExt;
use reqwest::multipart::{Form, Part as MPart};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent};
use tokio::{fs::File, io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

type R<T> = Result<T, String>;
fn es<E: std::fmt::Display>(e: E) -> String { e.to_string() }
fn ne(e: reqwest::Error) -> String { e.without_url().to_string() }   // never leak the bot token in errors
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 }
const PART: u64 = 19_000_000;   // Telegram lets bots download files up to 20 MB, so parts stay below that

#[derive(Serialize, Deserialize, Default, Clone)]
struct Cfg { token: Option<String>, gid: Option<String>, gsecret: Option<String>, owner: Option<i64> }
#[derive(Serialize, Deserialize, Clone)]
struct Acct { email: String, refresh: String, folder: Option<String> }
#[derive(Serialize, Deserialize, Clone)]
struct Chan { id: i64, title: String, username: Option<String> }
#[derive(Serialize, Deserialize, Clone)]
struct Piece { msg: i64, fid: Option<String> }
#[derive(Serialize, Deserialize, Clone, Default)]
struct FileRec {
    id: u64, name: String, size: u64, kind: String, #[serde(rename = "where")] loc: String, folder: String, from: String,
    at: u64, link: Option<String>, chat: Option<i64>, parts: Vec<Piece>, dl: bool, drive_id: Option<String>,
}
#[derive(Serialize, Deserialize, Clone)]
struct LogE { m: String, at: u64 }
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Db { cfg: Cfg, accounts: Vec<Acct>, channels: Vec<Chan>, files: Vec<FileRec>, log: Vec<LogE>, folders: Vec<String> }

struct App { h: AppHandle, path: PathBuf, db: Mutex<Db>, bot: Mutex<(Option<String>, i64)>, http: reqwest::Client }
type S<'a> = State<'a, Arc<App>>;
fn trunc(s: &str, n: usize) -> String { s.chars().take(n).collect() }
fn media(m: &Value) -> Option<(String, u64, Option<String>)> {
    let a = ["document", "video", "audio", "voice"].iter().find_map(|k| m.get(*k).filter(|v| !v.is_null()).cloned())
        .or_else(|| m["photo"].as_array().and_then(|a| a.last().cloned()))?;
    let name = a["file_name"].as_str().map(String::from).unwrap_or_else(|| if m.get("photo").is_some() { "photo.jpg".into() } else if m.get("voice").is_some() { "voice.ogg".into() } else { "file".into() });
    Some((name, a["file_size"].as_u64().unwrap_or(0), a["file_id"].as_str().map(String::from)))
}
fn tlink(c: &Chan, id: i64) -> Option<String> { c.username.as_ref().map(|u| format!("https://t.me/{u}/{id}")) }
fn tg_result(r: Value) -> R<Value> {
    if r["ok"] == true { Ok(r["result"].clone()) } else { Err(r["description"].as_str().unwrap_or("Telegram error").to_string()) }
}

impl App {
    fn save(&self) { let d = self.db.lock().unwrap(); let _ = std::fs::write(&self.path, serde_json::to_string_pretty(&*d).unwrap()); }
    fn log(&self, m: impl Into<String>) {
        { let mut d = self.db.lock().unwrap(); d.log.insert(0, LogE { m: m.into(), at: now() }); d.log.truncate(80); }
        self.save(); let _ = self.h.emit("changed", ());
    }
    fn busy(&self, t: &str) { let _ = self.h.emit("busy", t); }
    fn cfg(&self) -> Cfg { self.db.lock().unwrap().cfg.clone() }
    fn acct(&self, email: &str) -> R<Acct> { self.db.lock().unwrap().accounts.iter().find(|a| a.email == email).cloned().ok_or_else(|| "Account not found".to_string()) }
    fn pick(&self) -> Option<Chan> {
        let d = self.db.lock().unwrap();
        d.channels.iter().min_by_key(|c| d.files.iter().filter(|f| f.chat == Some(c.id)).count()).cloned()
    }
    fn add(&self, mut f: FileRec) -> u64 {
        let (id, n, l) = {
            let mut d = self.db.lock().unwrap();
            f.id = d.files.iter().map(|x| x.id).max().unwrap_or(0) + 1; f.at = now();
            if f.folder.is_empty() { f.folder = "General".into(); }
            let r = (f.id, f.name.clone(), f.loc.clone()); d.files.insert(0, f); r
        };
        self.log(format!("Stored {n} in {l}")); id
    }
    fn list(&self, p: impl Fn(&FileRec) -> bool) -> String {
        let d = self.db.lock().unwrap();
        let v: Vec<String> = d.files.iter().filter(|f| p(f)).take(15).map(|f| format!("#{} {}", f.id, f.name)).collect();
        if v.is_empty() { "No files found.".into() } else { v.join("\n") }
    }

    // ---------- Telegram ----------
    async fn tg(&self, method: &str, body: Value) -> R<Value> {
        let t = self.cfg().token.ok_or("Connect your Telegram bot in Settings first.")?;
        let mut r = Value::Null;
        for _ in 0..2 {   // retry once when Telegram answers "too many requests"
            r = self.http.post(format!("https://api.telegram.org/bot{t}/{method}")).json(&body).send().await.map_err(ne)?.json().await.map_err(ne)?;
            if r["error_code"] == 429 { tokio::time::sleep(Duration::from_secs(r["parameters"]["retry_after"].as_u64().unwrap_or(3).min(30))).await; } else { break; }
        }
        tg_result(r)
    }
    async fn say(&self, chat: i64, x: impl Into<String>) { let _ = self.tg("sendMessage", json!({"chat_id": chat, "text": x.into()})).await; }
    async fn tg_doc(&self, chat: i64, name: String, bytes: Vec<u8>) -> R<Value> {
        let t = self.cfg().token.ok_or("Connect your Telegram bot in Settings first.")?;
        let f = Form::new().text("chat_id", chat.to_string()).part("document", MPart::bytes(bytes).file_name(name));
        let r: Value = self.http.post(format!("https://api.telegram.org/bot{t}/sendDocument")).multipart(f).send().await.map_err(ne)?.json().await.map_err(ne)?;
        tg_result(r)
    }
    async fn tg_file(&self, fid: &str) -> R<Vec<u8>> {
        let r = self.tg("getFile", json!({"file_id": fid})).await?;
        let p = r["file_path"].as_str().ok_or("Telegram would not return this file")?;
        let t = self.cfg().token.unwrap_or_default();
        Ok(self.http.get(format!("https://api.telegram.org/file/bot{t}/{p}")).send().await.map_err(ne)?.bytes().await.map_err(ne)?.to_vec())
    }
    async fn refresh_bot(&self) {
        if self.cfg().token.is_none() { return; }
        match self.tg("getMe", json!({})).await {
            Ok(m) => { *self.bot.lock().unwrap() = (m["username"].as_str().map(String::from), m["id"].as_i64().unwrap_or(0)); let _ = self.h.emit("changed", ()); self.set_commands().await; }
            Err(_) => self.log("Telegram rejected the bot token."),
        }
    }
    async fn to_channel(&self, ch: &Chan, path: &str, name: &str, size: u64) -> R<Vec<Piece>> {
        let n = ((size + PART - 1) / PART).max(1);
        let mut f = File::open(path).await.map_err(es)?; let mut out = vec![];
        for i in 0..n {
            self.busy(&format!("Uploading {name} ({}/{n})", i + 1));
            let mut buf = vec![0u8; PART.min(size - i * PART) as usize];
            f.read_exact(&mut buf).await.map_err(es)?;
            let fname = if n > 1 { format!("{name}.part{:03}", i + 1) } else { name.to_string() };
            let m = self.tg_doc(ch.id, fname, buf).await?;
            out.push(Piece { msg: m["message_id"].as_i64().unwrap_or(0), fid: m["document"]["file_id"].as_str().map(String::from) });
        }
        Ok(out)
    }
    async fn send_back(&self, chat: i64, id: u64) -> R<()> {
        let f = self.db.lock().unwrap().files.iter().find(|f| f.id == id).cloned();
        let Some(f) = f else { self.say(chat, "File not found.").await; return Ok(()); };
        if f.kind == "channel" {
            if f.parts.len() == 1 { self.tg("copyMessage", json!({"chat_id": chat, "from_chat_id": f.chat, "message_id": f.parts[0].msg})).await?; }
            else { self.say(chat, "This file is split into parts. Download it in the Vault app.").await; }
        } else {
            let t = self.gtoken(&self.acct(&f.loc)?).await?;
            let b = self.http.get(format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", f.drive_id.clone().unwrap_or_default()))
                .bearer_auth(t).send().await.map_err(ne)?.bytes().await.map_err(ne)?;
            self.tg_doc(chat, f.name.clone(), b.to_vec()).await?;
        }
        Ok(())
    }
    async fn on_message(&self, m: &Value) -> R<()> {
        if m.is_null() { return Ok(()); }
        let chat = m["chat"]["id"].as_i64().unwrap_or(0); let uid = m["from"]["id"].as_i64().unwrap_or(0);
        let t = m["text"].as_str().unwrap_or("");
        if t.starts_with("/start") {
            let claimed = { let mut d = self.db.lock().unwrap(); if d.cfg.owner.is_none() { d.cfg.owner = Some(uid); true } else { false } };
            if claimed { self.save(); self.log("Bot locked to its first user"); }
        }
        if self.cfg().owner != Some(uid) { return Ok(()); }
        if t.starts_with("/start") || t.starts_with("/help") {
            self.say(chat, "Send me any file, photo or video and I store it for you.\n\n/files  browse, get or delete files\n/folders  browse by folder\n/find <text>  search by name\n/get <id>  send a file back\n/storage  space overview\n\nTip: a caption on a file picks its folder.").await; return Ok(());
        }
        if t.starts_with("/files") { let (x, k) = self.page_view(0, 0); self.tg("sendMessage", json!({"chat_id": chat, "text": x, "reply_markup": k})).await?; return Ok(()); }
        if t.starts_with("/folders") { let (x, k) = self.folders_view(); self.tg("sendMessage", json!({"chat_id": chat, "text": x, "reply_markup": k})).await?; return Ok(()); }
        if t.starts_with("/storage") {
            let (f, c, accts) = { let d = self.db.lock().unwrap(); (d.files.len(), d.channels.len(), d.accounts.clone()) };
            let mut out = format!("{f} files in {c} channels");
            for a in accts { match self.quota(&a).await {
                Ok((l, u, _)) => out += &format!("\n{}: {:.1} of {} GB", a.email, u as f64 / 1e9, if l > 0 { format!("{:.0}", l as f64 / 1e9) } else { "unlimited".into() }),
                Err(_) => out += &format!("\n{}: sign-in expired", a.email) } }
            self.say(chat, out).await; return Ok(());
        }
        if let Some(q) = t.strip_prefix("/find ") { let q = q.to_lowercase(); let r = self.list(|f| f.name.to_lowercase().contains(&q)); self.say(chat, r).await; return Ok(()); }
        if t.starts_with("/list") { let r = self.list(|_| true); self.say(chat, r).await; return Ok(()); }
        if let Some(id) = t.strip_prefix("/get ") {
            if let Ok(id) = id.trim().parse::<u64>() { if let Err(e) = self.send_back(chat, id).await { self.say(chat, e).await; } }
            return Ok(());
        }
        let Some((name, size, fid)) = media(m) else { return Ok(()); };
        let folder: String = m["caption"].as_str().unwrap_or("").trim().chars().take(30).collect();
        let wait = self.tg("sendMessage", json!({"chat_id": chat, "text": "⏳ Saving…", "reply_to_message_id": m["message_id"]})).await.ok().and_then(|r| r["message_id"].as_i64());
        let res: R<(u64, String)> = async {
            if let Some(ch) = self.pick() {
                let r = self.tg("copyMessage", json!({"chat_id": ch.id, "from_chat_id": chat, "message_id": m["message_id"]})).await?;
                let mid = r["message_id"].as_i64().unwrap_or(0);
                let id = self.add(FileRec { name: name.clone(), size, kind: "channel".into(), loc: ch.title.clone(), folder: folder.clone(), from: "Bot".into(), chat: Some(ch.id),
                    parts: vec![Piece { msg: mid, fid: fid.clone() }], dl: size <= 20_000_000, link: tlink(&ch, mid), ..Default::default() });
                Ok((id, ch.title.clone()))
            } else if let Some(acc) = self.best_drive().await {
                if size > 20_000_000 { return Err("Over 20 MB: Telegram does not let bots download it. Add a channel so I can copy it instead.".to_string()); }
                let bytes = self.tg_file(fid.as_deref().ok_or("No file id")?).await?;
                let tmp = std::env::temp_dir().join(format!("vault-{}", now()));
                tokio::fs::write(&tmp, &bytes).await.map_err(es)?;
                let r = self.to_drive(&acc, &tmp.to_string_lossy(), &name, bytes.len() as u64).await;
                let _ = tokio::fs::remove_file(&tmp).await;
                let mut f = r?; f.folder = folder.clone(); f.from = "Bot".into(); let l = f.loc.clone();
                Ok((self.add(f), l))
            } else { Err("Add a channel or a Google account in the Vault app first.".to_string()) }
        }.await;
        let text = match &res { Ok((id, loc)) => format!("✅ Saved #{id} in {loc}"), Err(e) => format!("❌ {e}") };
        match wait { Some(w) => self.edit(chat, w, &text, None).await, None => self.say(chat, text).await }
        Ok(())
    }
    async fn on_channel_post(&self, m: &Value) -> R<()> {   // files posted straight into a storage channel get indexed
        let cid = m["chat"]["id"].as_i64().unwrap_or(0); let mid = m["message_id"].as_i64().unwrap_or(0);
        let ch = self.db.lock().unwrap().channels.iter().find(|c| c.id == cid).cloned();
        let Some(ch) = ch else { return Ok(()); };
        let Some((name, size, fid)) = media(m) else { return Ok(()); };
        if self.db.lock().unwrap().files.iter().any(|f| f.chat == Some(cid) && f.parts.iter().any(|p| p.msg == mid)) { return Ok(()); }
        let folder: String = m["caption"].as_str().unwrap_or("").trim().chars().take(30).collect();
        self.add(FileRec { name, size, kind: "channel".into(), loc: ch.title.clone(), folder, from: "Channel".into(), chat: Some(cid),
            parts: vec![Piece { msg: mid, fid }], dl: size <= 20_000_000, link: tlink(&ch, mid), ..Default::default() });
        Ok(())
    }
    async fn on_callback(&self, q: &Value) -> R<()> {      // taps on inline buttons
        if self.cfg().owner != Some(q["from"]["id"].as_i64().unwrap_or(0)) { return Ok(()); }
        let chat = q["message"]["chat"]["id"].as_i64().unwrap_or(0); let mid = q["message"]["message_id"].as_i64().unwrap_or(0);
        let _ = self.tg("answerCallbackQuery", json!({"callback_query_id": q["id"]})).await;
        let mut it = q["data"].as_str().unwrap_or("").split(':');
        let (a, b, c) = (it.next().unwrap_or(""), it.next().unwrap_or(""), it.next().unwrap_or(""));
        match a {
            "p" => { let (x, k) = self.page_view(b.parse().unwrap_or(0), c.parse().unwrap_or(0)); self.edit(chat, mid, &x, Some(k)).await; }
            "f" => { let (x, k) = self.folders_view(); self.edit(chat, mid, &x, Some(k)).await; }
            "g" => { if let Err(e) = self.send_back(chat, b.parse().unwrap_or(0)).await { self.say(chat, e).await; } }
            "d" => {
                let id: u64 = b.parse().unwrap_or(0);
                let name = self.db.lock().unwrap().files.iter().find(|f| f.id == id).map(|f| f.name.clone()).unwrap_or_default();
                self.edit(chat, mid, &format!("Delete {name}? It is removed from storage."), Some(json!({"inline_keyboard": [[{"text": "Yes, delete", "callback_data": format!("y:{id}")}, {"text": "Cancel", "callback_data": "p:0:0"}]]}))).await;
            }
            "y" => { self.delete_file(b.parse().unwrap_or(0)).await?; let (x, k) = self.page_view(0, 0); self.edit(chat, mid, &x, Some(k)).await; }
            _ => {}
        }
        Ok(())
    }
    async fn set_commands(&self) {
        let c = [("files", "Browse your files"), ("folders", "Browse by folder"), ("find", "Search by name"), ("storage", "Space overview"), ("help", "How to use the bot")];
        let _ = self.tg("setMyCommands", json!({"commands": c.iter().map(|(a, b)| json!({"command": a, "description": b})).collect::<Vec<_>>()})).await;
    }
    async fn edit(&self, chat: i64, mid: i64, text: &str, kb: Option<Value>) {
        let mut b = json!({"chat_id": chat, "message_id": mid, "text": text});
        if let Some(k) = kb { b["reply_markup"] = k; }
        let _ = self.tg("editMessageText", b).await;
    }
    fn folder_list(&self) -> Vec<String> {
        let d = self.db.lock().unwrap(); let mut fo = vec!["General".to_string()];
        for f in d.folders.iter().cloned().chain(d.files.iter().map(|f| f.folder.clone())) { if !fo.contains(&f) { fo.push(f); } }
        fo
    }
    fn page_view(&self, fi: usize, page: usize) -> (String, Value) {
        let sel = if fi == 0 { None } else { self.folder_list().get(fi - 1).cloned() };
        let d = self.db.lock().unwrap();
        let all: Vec<&FileRec> = d.files.iter().filter(|f| sel.as_ref().map_or(true, |s| &f.folder == s)).collect();
        let per = 5; let pages = ((all.len() + per - 1) / per).max(1); let page = page.min(pages - 1);
        let mut rows: Vec<Value> = all.iter().skip(page * per).take(per).map(|f| json!([
            {"text": format!("⬇ {}", trunc(&f.name, 28)), "callback_data": format!("g:{}", f.id)}, {"text": "🗑", "callback_data": format!("d:{}", f.id)}])).collect();
        let mut nav = vec![];
        if page > 0 { nav.push(json!({"text": "◀", "callback_data": format!("p:{fi}:{}", page - 1)})); }
        if page + 1 < pages { nav.push(json!({"text": "▶", "callback_data": format!("p:{fi}:{}", page + 1)})); }
        if !nav.is_empty() { rows.push(json!(nav)); }
        rows.push(json!([{"text": "📁 Folders", "callback_data": "f::"}]));
        (format!("{}: {} files, page {}/{}", sel.as_deref().unwrap_or("All files"), all.len(), page + 1, pages), json!({"inline_keyboard": rows}))
    }
    fn folders_view(&self) -> (String, Value) {
        let fo = self.folder_list(); let d = self.db.lock().unwrap();
        let mut rows = vec![json!([{"text": format!("All files ({})", d.files.len()), "callback_data": "p:0:0"}])];
        for (i, f) in fo.iter().enumerate() {
            let n = d.files.iter().filter(|x| &x.folder == f).count();
            rows.push(json!([{"text": format!("📁 {} ({n})", trunc(f, 30)), "callback_data": format!("p:{}:0", i + 1)}]));
        }
        ("Choose a folder".to_string(), json!({"inline_keyboard": rows}))
    }
    async fn delete_file(&self, id: u64) -> R<()> {
        let f = self.db.lock().unwrap().files.iter().find(|f| f.id == id).cloned();
        let Some(f) = f else { return Ok(()); };
        if f.kind == "channel" { for p in &f.parts { let _ = self.tg("deleteMessage", json!({"chat_id": f.chat, "message_id": p.msg})).await; } }
        else if let Ok(a) = self.acct(&f.loc) { if let Ok(t) = self.gtoken(&a).await {
            let _ = self.http.delete(format!("https://www.googleapis.com/drive/v3/files/{}", f.drive_id.clone().unwrap_or_default())).bearer_auth(t).send().await; } }
        self.db.lock().unwrap().files.retain(|x| x.id != id); self.log(format!("Deleted {}", f.name)); Ok(())
    }

    // ---------- Google Drive ----------
    async fn gtoken(&self, a: &Acct) -> R<String> {
        let c = self.cfg();
        let r: Value = self.http.post("https://oauth2.googleapis.com/token").form(&[("client_id", c.gid.unwrap_or_default()), ("client_secret", c.gsecret.unwrap_or_default()),
            ("refresh_token", a.refresh.clone()), ("grant_type", "refresh_token".to_string())]).send().await.map_err(ne)?.json().await.map_err(ne)?;
        r["access_token"].as_str().map(String::from).ok_or_else(|| "Google access expired. Connect this email again.".to_string())
    }
    async fn quota(&self, a: &Acct) -> R<(u64, u64, String)> {
        let t = self.gtoken(a).await?;
        let r: Value = self.http.get("https://www.googleapis.com/drive/v3/about?fields=storageQuota,user(displayName)").bearer_auth(t).send().await.map_err(ne)?.json().await.map_err(ne)?;
        if r["storageQuota"].is_null() { return Err("No quota".into()); }
        let p = |k: &str| r["storageQuota"][k].as_str().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        Ok((p("limit"), p("usage"), r["user"]["displayName"].as_str().unwrap_or("").to_string()))
    }
    async fn best_drive(&self) -> Option<Acct> {
        let accts = self.db.lock().unwrap().accounts.clone(); let mut best: Option<(u64, Acct)> = None;
        for a in accts {
            if let Ok((l, u, _)) = self.quota(&a).await {
                let free = if l > 0 { l.saturating_sub(u) } else { u64::MAX };
                if best.as_ref().map_or(true, |b| free > b.0) { best = Some((free, a)); }
            }
        }
        best.map(|b| b.1)
    }
    async fn to_drive(&self, a: &Acct, path: &str, name: &str, size: u64) -> R<FileRec> {
        let t = self.gtoken(a).await?;
        let folder = match a.folder.clone() {
            Some(f) => f,
            None => {
                let r: Value = self.http.post("https://www.googleapis.com/drive/v3/files?fields=id").bearer_auth(&t)
                    .json(&json!({"name": "Vault", "mimeType": "application/vnd.google-apps.folder"})).send().await.map_err(ne)?.json().await.map_err(ne)?;
                let id = r["id"].as_str().ok_or("Could not create the Vault folder")?.to_string();
                { let mut d = self.db.lock().unwrap(); if let Some(x) = d.accounts.iter_mut().find(|x| x.email == a.email) { x.folder = Some(id.clone()); } }
                self.save(); id
            }
        };
        self.busy(&format!("Uploading {name}"));
        let init = self.http.post("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,webViewLink").bearer_auth(&t)
            .json(&json!({"name": name, "parents": [folder]})).send().await.map_err(ne)?;
        let loc = init.headers().get("location").and_then(|v| v.to_str().ok()).ok_or("Google refused the upload")?.to_string();
        let body = reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(File::open(path).await.map_err(es)?));
        let r: Value = self.http.put(loc).header("Content-Length", size).body(body).send().await.map_err(ne)?.json().await.map_err(ne)?;
        if r["id"].is_null() { return Err(r["error"]["message"].as_str().unwrap_or("Drive upload failed").to_string()); }
        Ok(FileRec { name: name.into(), size, kind: "drive".into(), loc: a.email.clone(), drive_id: r["id"].as_str().map(String::from), link: r["webViewLink"].as_str().map(String::from), dl: true, ..Default::default() })
    }
}

async fn poll(app: Arc<App>) {
    let mut off = 0i64;
    loop {
        if app.cfg().token.is_none() { tokio::time::sleep(Duration::from_secs(2)).await; continue; }
        match app.tg("getUpdates", json!({"offset": off, "timeout": 25, "allowed_updates": ["message", "callback_query", "channel_post"]})).await {
            Ok(u) => for x in u.as_array().cloned().unwrap_or_default() {
                off = x["update_id"].as_i64().unwrap_or(0) + 1;
                let r = if !x["callback_query"].is_null() { app.on_callback(&x["callback_query"]).await }
                    else if !x["channel_post"].is_null() { app.on_channel_post(&x["channel_post"]).await }
                    else { app.on_message(&x["message"]).await };
                if let Err(e) = r { app.log(format!("Bot: {e}")); }
            },
            Err(_) => tokio::time::sleep(Duration::from_secs(5)).await,
        }
    }
}

// ---------- commands (called from the UI) ----------
#[derive(Deserialize)] struct CfgIn { token: Option<String>, gid: Option<String>, gsecret: Option<String>, #[serde(rename = "resetOwner")] reset_owner: Option<bool> }
#[derive(Deserialize)] struct Up { dest: String, folder: String, paths: Option<Vec<String>> }
#[derive(Deserialize)] struct Mv { id: u64, folder: String }

#[tauri::command]
async fn state(app: S<'_>) -> R<Value> {
    let ap: Arc<App> = app.inner().clone();
    let (cfg, accts, chans, files, log, folders) = { let d = ap.db.lock().unwrap(); (d.cfg.clone(), d.accounts.clone(), d.channels.clone(), d.files.clone(), d.log.clone(), d.folders.clone()) };
    let (apr, fr) = (&ap, &files);
    let accounts = futures_util::future::join_all(accts.iter().map(|a| async move {
        let n = fr.iter().filter(|f| f.loc == a.email).count();
        match apr.quota(a).await {
            Ok((l, u, name)) => json!({"email": a.email, "files": n, "ok": true, "limit": l, "usage": u, "name": name}),
            Err(_) => json!({"email": a.email, "files": n, "ok": false, "limit": 0, "usage": 0}),
        }
    })).await;
    let channels: Vec<Value> = chans.iter().map(|c| { let f: Vec<_> = files.iter().filter(|x| x.chat == Some(c.id)).collect();
        json!({"id": c.id, "title": c.title, "username": c.username, "files": f.len(), "bytes": f.iter().map(|x| x.size).sum::<u64>()}) }).collect();
    let mut fo = vec!["General".to_string()];
    for f in folders.into_iter().chain(files.iter().map(|f| f.folder.clone())) { if !fo.contains(&f) { fo.push(f); } }
    Ok(json!({"bot": ap.bot.lock().unwrap().0.clone(), "cfg": {"token": cfg.token.is_some(), "google": cfg.gid.is_some() && cfg.gsecret.is_some(), "owner": cfg.owner.is_some()},
        "channels": channels, "accounts": accounts, "folders": fo, "files": files.iter().take(500).collect::<Vec<_>>(), "log": log}))
}
#[tauri::command]
async fn save_cfg(app: S<'_>, c: CfgIn) -> R<()> {
    let ne_ = |s: Option<String>| s.filter(|x| !x.is_empty());
    let token = ne_(c.token);
    { let mut d = app.db.lock().unwrap();
      if let Some(t) = &token { d.cfg.token = Some(t.clone()); }
      if let Some(x) = ne_(c.gid) { d.cfg.gid = Some(x); }
      if let Some(x) = ne_(c.gsecret) { d.cfg.gsecret = Some(x); }
      if c.reset_owner == Some(true) { d.cfg.owner = None; } }
    app.save();
    if token.is_some() { let a = app.inner().clone(); tauri::async_runtime::spawn(async move { a.refresh_bot().await }); }
    let _ = app.h.emit("changed", ()); Ok(())
}
#[tauri::command]
async fn add_channel(app: S<'_>, r: String) -> R<()> {
    let id: Value = if let Ok(n) = r.parse::<i64>() { json!(n) } else { json!(r) };
    let c = app.tg("getChat", json!({"chat_id": id})).await?;
    let cid = c["id"].as_i64().ok_or("Channel not found")?;
    let bid = app.bot.lock().unwrap().1;
    let me = app.tg("getChatMember", json!({"chat_id": cid, "user_id": bid})).await?;
    if !matches!(me["status"].as_str(), Some("administrator") | Some("creator")) { return Err("Add the bot as an admin of that channel first.".into()); }
    let title = c["title"].as_str().unwrap_or("Channel").to_string();
    { let mut d = app.db.lock().unwrap(); if !d.channels.iter().any(|x| x.id == cid) { d.channels.push(Chan { id: cid, title: title.clone(), username: c["username"].as_str().map(String::from) }); } }
    app.log(format!("Channel {title} added")); Ok(())
}
#[tauri::command]
async fn remove_channel(app: S<'_>, id: i64) -> R<()> { app.db.lock().unwrap().channels.retain(|c| c.id != id); app.log("Channel removed"); Ok(()) }
#[tauri::command]
async fn remove_drive(app: S<'_>, email: String) -> R<()> { app.db.lock().unwrap().accounts.retain(|a| a.email != email); app.log(format!("Removed {email}")); Ok(()) }
#[tauri::command]
async fn add_drive(app: S<'_>, email: String) -> R<()> {
    let c = app.cfg();
    let (gid, gsecret) = (c.gid.ok_or("Add your Google client ID and secret in Settings first.")?, c.gsecret.ok_or("Add your Google client secret in Settings first.")?);
    let l = TcpListener::bind("127.0.0.1:0").await.map_err(es)?;
    let redirect = format!("http://127.0.0.1:{}", l.local_addr().map_err(es)?.port());
    let scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
    let url = format!("https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&access_type=offline&prompt=consent&login_hint={}&scope={}",
        urlencoding::encode(&gid), urlencoding::encode(&redirect), urlencoding::encode(&email), urlencoding::encode(scope));
    open::that(url).map_err(es)?;
    let code = tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let (mut s, _) = l.accept().await.map_err(es)?;
            let mut buf = [0u8; 4096]; let n = s.read(&mut buf).await.map_err(es)?;
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let reply = |t: &str| format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n<h3>{t}</h3>");
            if let Some(i) = req.find("code=") {
                let rest = &req[i + 5..]; let end = rest.find(|c| c == '&' || c == ' ').unwrap_or(rest.len());
                let code = urlencoding::decode(&rest[..end]).map_err(es)?.to_string();
                let _ = s.write_all(reply("Connected. You can close this tab and return to Vault.").as_bytes()).await;
                return Ok::<String, String>(code);
            }
            if req.contains("error=") { let _ = s.write_all(reply("Sign-in cancelled.").as_bytes()).await; return Err("Google sign-in was cancelled.".to_string()); }
        }
    }).await.map_err(|_| "Sign-in timed out.".to_string())??;
    let tk: Value = app.http.post("https://oauth2.googleapis.com/token").form(&[("code", code), ("client_id", gid), ("client_secret", gsecret),
        ("redirect_uri", redirect), ("grant_type", "authorization_code".to_string())]).send().await.map_err(ne)?.json().await.map_err(ne)?;
    let at = tk["access_token"].as_str().ok_or("Google did not accept the sign-in")?.to_string();
    let ui: Value = app.http.get("https://www.googleapis.com/oauth2/v2/userinfo").bearer_auth(at).send().await.map_err(ne)?.json().await.map_err(ne)?;
    let em = ui["email"].as_str().ok_or("Could not read the account email")?.to_string();
    let rt = tk["refresh_token"].as_str().map(String::from);
    { let mut d = app.db.lock().unwrap();
      match (d.accounts.iter_mut().find(|a| a.email == em), rt) {
        (Some(a), Some(r)) => a.refresh = r, (Some(_), None) => {},
        (None, Some(r)) => d.accounts.push(Acct { email: em.clone(), refresh: r, folder: None }),
        (None, None) => return Err("Google gave no offline access. Remove Vault from your Google account's connected apps and try again.".into()),
      } }
    app.log(format!("Connected {em}")); Ok(())
}
async fn up_one(app: &Arc<App>, dest: &str, folder: &str, p: &str) -> R<()> {
    let size = std::fs::metadata(p).map_err(es)?.len();
    let name = Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let d = if dest == "auto" {
        if let Some(c) = app.pick() { format!("ch:{}", c.id) } else if let Some(a) = app.best_drive().await { format!("dr:{}", a.email) }
        else { return Err("Add a channel or a Google account first.".into()); }
    } else { dest.to_string() };
    if let Some(id) = d.strip_prefix("ch:") {
        let ch = app.db.lock().unwrap().channels.iter().find(|c| c.id.to_string() == id).cloned().ok_or("Channel not found")?;
        let parts = app.to_channel(&ch, p, &name, size).await?; let link = tlink(&ch, parts[0].msg);
        app.add(FileRec { name, size, kind: "channel".into(), loc: ch.title.clone(), folder: folder.into(), from: "Desktop".into(), chat: Some(ch.id), parts, dl: true, link, ..Default::default() });
    } else if let Some(em) = d.strip_prefix("dr:") {
        let mut f = app.to_drive(&app.acct(em)?, p, &name, size).await?; f.folder = folder.into(); f.from = "Desktop".into(); app.add(f);
    }
    Ok(())
}
#[tauri::command]
async fn upload(app: S<'_>, o: Up) -> R<()> {
    let ap: Arc<App> = app.inner().clone();
    let paths = match o.paths { Some(p) => p, None => match rfd::AsyncFileDialog::new().pick_files().await {
        Some(v) => v.iter().map(|f| f.path().to_string_lossy().to_string()).collect(), None => return Ok(()) } };
    for p in paths { if let Err(e) = up_one(&ap, &o.dest, &o.folder, &p).await { ap.log(format!("Upload failed: {p}: {e}")); } }
    ap.busy(""); Ok(())
}
#[tauri::command]
async fn download(app: S<'_>, id: u64) -> R<()> {
    let f = app.db.lock().unwrap().files.iter().find(|f| f.id == id).cloned().ok_or("File not found")?;
    if f.kind == "channel" && !f.dl { return Err("Telegram does not let apps download bot-added files over 20 MB. Use /get in the bot to receive it.".into()); }
    let path = match rfd::AsyncFileDialog::new().set_file_name(&f.name).save_file().await { Some(h) => h.path().to_path_buf(), None => return Ok(()) };
    let res: R<()> = async {
        let mut out = File::create(&path).await.map_err(es)?;
        if f.kind == "drive" {
            let t = app.gtoken(&app.acct(&f.loc)?).await?;
            let r = app.http.get(format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", f.drive_id.clone().unwrap_or_default())).bearer_auth(t).send().await.map_err(ne)?;
            let mut s = r.bytes_stream();
            while let Some(c) = s.next().await { out.write_all(&c.map_err(ne)?).await.map_err(es)?; }
        } else {
            for (i, p) in f.parts.iter().enumerate() {
                app.busy(&format!("Downloading {} ({}/{})", f.name, i + 1, f.parts.len()));
                let b = app.tg_file(p.fid.as_deref().ok_or("Missing file id")?).await?; out.write_all(&b).await.map_err(es)?;
            }
        }
        Ok(())
    }.await;
    app.busy(""); res?;
    if let Some(dir) = path.parent() { let _ = open::that(dir); }
    Ok(())
}
#[tauri::command]
async fn remove_file(app: S<'_>, id: u64) -> R<()> { app.delete_file(id).await }
#[tauri::command]
async fn move_file(app: S<'_>, o: Mv) -> R<()> {
    if let Some(f) = app.db.lock().unwrap().files.iter_mut().find(|f| f.id == o.id) { f.folder = o.folder; }
    app.save(); let _ = app.h.emit("changed", ()); Ok(())
}
#[tauri::command]
async fn add_folder(app: S<'_>, name: String) -> R<()> {
    if !name.is_empty() { { let mut d = app.db.lock().unwrap(); if !d.folders.contains(&name) { d.folders.push(name); } } app.save(); let _ = app.h.emit("changed", ()); }
    Ok(())
}
#[tauri::command]
async fn open_link(url: String) -> R<()> { if url.starts_with("https://") { open::that(url).map_err(es)?; } Ok(()) }

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir().unwrap(); std::fs::create_dir_all(&dir).ok();
            let path = dir.join("vault.json");
            let db: Db = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            let a = Arc::new(App { h: app.handle().clone(), path, db: Mutex::new(db), bot: Mutex::new((None, 0)), http: reqwest::Client::new() });
            app.manage(a.clone());
            tauri::async_runtime::spawn(async move { a.refresh_bot().await; poll(a).await });
            Ok(())
        })
        .on_window_event(|w, e| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = e {
                let _ = w.emit("drop", paths.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>());
            }
        })
        .invoke_handler(tauri::generate_handler![state, save_cfg, add_channel, remove_channel, add_drive, remove_drive, upload, download, remove_file, move_file, add_folder, open_link])
        .run(tauri::generate_context!())
        .expect("error while running Vault");
}
