# Vault: Telegram bot + channels + Google Drives

Extract the zip, then double-click **run.bat** (needs Rust from https://rustup.rs). First start compiles for a few minutes.
`build-installer.bat` makes a Windows installer.

## Setup (in the app, Settings)
1. @BotFather: create a bot, paste its token, then send the bot `/start` (it locks to you).
2. Make a Telegram channel, add the bot as admin, then Storage > Add channel.
3. Google Cloud: enable Drive API, create an OAuth client of type *Desktop app*, paste ID + secret, add your Gmails as test users, then Storage > type a Gmail > Connect.

## Bot
Send any file: it is copied to the channel with the fewest files (or saved to the Drive with most free space when there are no channels). A caption picks the folder.
/files (buttons to get or delete, paging), /folders, /find, /get <id>, /storage, /help. Files posted directly in a storage channel are indexed automatically.
"# Vault-Telegram" 
