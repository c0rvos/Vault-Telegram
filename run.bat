@echo off
cd /d "%~dp0"
where cargo >nul 2>nul || (echo Install Rust first: https://rustup.rs & pause & exit /b 1)
cargo tauri --version >nul 2>nul || cargo install tauri-cli --version "^2" --locked
cargo tauri dev
pause
