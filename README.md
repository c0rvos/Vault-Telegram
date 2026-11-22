# Vault

Vault is a local desktop file library with a Telegram bot front end. It runs as an Electron app, keeps its index on your PC, and uses Telegram for chatting with the bot and for optional folder-tree backup.

It is a React + TypeScript app with three small back ends:

- **Electron** (`electron/`) — desktop window, Telegram bot, and Python bridge.
- **Python** (`model/vault_model.py`) — predicts the best channel and folder for a new file. If Python or scikit-learn is missing, Vault falls back to a built-in Naive Bayes classifier.
- **GramJS** (`telegram` npm package) — signs in with your Telegram **user** account so Vault can save and restore your folder structure in channels.

## What Vault does

- Keeps a local file index in `vault.json` with folders, channels, settings, and a bot log.
- Lets you create, rename, move, and delete folders. Moving a folder also moves its whole subtree and updates every indexed file inside it.
- Selects files the Windows way: left-click, `Ctrl`/`Cmd`+click, `Shift`+click, `Ctrl+A`, checkboxes, marquee drag, and `Ctrl`+arrow keys.
- Moves one or many files by drag-and-drop, the context menu, or **Move all**. Folders can be dragged too.
- Searches by name, folder, extension, type, size, modified date, and hidden state — for example `*.png`, `ext:pdf`, `type:image`, `size:>10mb`, `modified:>2026-01-01`, `hidden`, or `!hidden`.
- Runs a real Telegram bot while the app is open: files sent to it are downloaded from Telegram, posted into your configured channel, and indexed with their real message IDs.
- Answers `/files`, `/folders`, `/find`, `/get`, `/storage`, `/auto`, and `/help` in Telegram.
- Can save your folder tree to Telegram channels and restore it later. Folder sync covers folders only. The library's own Upload/Download buttons are simulated, but files sent to the bot are real.
- Learns from filenames, folders, sizes, and captions. It never reads file contents.

> The bot only runs while the Vault app is open, because the app is what talks to Telegram.

## Requirements

- Windows 10 or 11.
- Node.js 20.19+ (Node 22 LTS recommended) and npm.
- A Telegram account and a bot token from @BotFather.
- Optional: Python 3.11+ for the Python AI model. Run `pip install -r model/requirements.txt` inside `model/`. The built-in fallback works without it.

## Run from source

```bat
npm.cmd install
run.bat
```

`run.bat` builds the React app and starts the Electron window. If you prefer the commands directly:

```bat
npm.cmd start
```

To build the Windows installer:

```bat
build-installer.bat
```

or:

```bat
npm.cmd run dist
```

The installer is written to `release\Vault Setup 0.0.0.exe`.

---

## 1. Create the bot

1. In Telegram, search for **@BotFather** (the one with the blue check) and open it.
2. Send `/newbot`.
3. Enter a display name, for example `My Vault`.
4. Enter a username that ends in `bot`, for example `my_vault_storage_bot`.
5. BotFather replies with a token that looks like `123456789:AAH....`. Copy it and keep it private, since anyone with it can control your bot.

## 2. Create the storage channel

1. In Telegram, create a **New Channel**. A private one is fine.
2. Open the channel, then go to **Administrators**, then **Add Administrator**, and search for your bot's username.
3. Give it the **Post Messages** and **Delete Messages** permissions. Deleting files from Vault needs the second one.

## 3. Connect everything in Vault

1. Start the app with `run.bat`.
2. Open **Settings**, paste the token, and click **Connect** (called **Save** in older builds). The bottom-left corner should change to `@your_bot_name`.
3. Open your bot in Telegram and send `/start`. The bot locks to the first person who does this, so do it yourself right away.
4. Open **Storage**, type the channel in the box, and click **Add channel**:
   - For a public channel, use `@channelname`.
   - For a private channel, use the numeric ID. Open the channel in [web.telegram.org](https://web.telegram.org) and look at the address: `.../c/1234567890/...` means the ID is `-1001234567890`.

### Optional: sync your folder tree

The bot token above is separate from Telegram folder sync. To back up and restore folders:

1. Create an app at [my.telegram.org/apps](https://my.telegram.org/apps) to get an **API ID** and **API hash**.
2. In Vault, open **Settings → Telegram folder sync**, enter those values and your phone number, then click **Sign in**. Enter the login code Telegram sends you, and your two-step password if prompted.
3. Add the same channels to the **Sync channels** box, separated by commas.
4. Use **Save folders to channels** on this PC and **Restore folders from channels** on another PC.

Adding a channel also scans it for existing Telegram items and imports them into the index.

## 4. Test it

Send any file to your bot. It should answer `Saving…` and then `Saved #1 in (your channel)`. Open the channel in Telegram and you will see the actual file. Try `/files` to see your files as buttons.

The **Bot** panel inside Vault is only a local simulator; use the real Telegram chat with your bot for real uploads.

If the channel step says the bot isn't an admin, recheck step 2. Google Drive setup is not covered here yet.

---

## Using the file library

- **Add a folder** from the folder tree or the Files toolbar. Double-click a folder to open it; use the breadcrumb bar to go back up.
- **Move files**: select one or many, then drag them onto a folder or use **Move to folder…** / **Move all**. Dropping on **All files** moves them to the root.
- **Move folders**: drag a folder from the list or sidebar onto another folder, or right-click and choose **Move to folder…**. A folder cannot be moved inside itself or one of its descendants.
- **Hide files** with the context menu, then use the eye toggle in the toolbar to reveal hidden items.
- **Train the AI**: open **Settings → AI brain**. Vault learns from bot saves, moves, folder choices, and channel scans. Use **Restart AI** after changing the Python model.

## Data and privacy

- Your index lives in the app's local storage and can be exported from **Settings → Export index**. The exported copy hides the bot token.
- The bot token stays on your PC. Never share it.
- Folder names and structure are what get pushed to Telegram channels. File contents are never sent to the AI model.
- **Settings → Clear** removes the local index, channels, and settings. Export first if you want a backup.

## Troubleshooting

- **The bottom-left still shows bot log instead of `@username`** — the token is wrong or the bot could not be reached. Reopen Settings and reconnect.
- **"Bot is not an administrator"** — recheck step 2 and make sure the bot was added to the exact channel you typed in Storage.
- **Private channel ID not working** — include the `-100` prefix exactly as shown in `web.telegram.org`.
- **"Desktop only — open the Electron app"** — you are running the browser dev server. Use `run.bat` or the installed app.
- **AI says Python is unavailable** — install the requirements in `model/`, or ignore it; the built-in classifier still works.
