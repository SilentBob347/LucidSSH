# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-07-25

First release of LucidSSH — a simple SSH client for Windows. Fully local: no account, no cloud, no telemetry.

### Added

- **SSH connections**: password and private key authentication (RSA/Ed25519/ECDSA, with passphrase), server fingerprint verification on every connection with storage in `known_hosts`, ProxyJump/jump host support.
- **Host manager**: saved servers with groups, quick SSH key setup wizard, warning about keys not being portable between PCs.
- **Terminal**: multiple tabs, buffer search, context menu, live connection stepper instead of a blank terminal while the session is being established, reconnection after dropped connections.
- **Dangerous command guard**: intercepts destructive and irreversible commands (`rm -rf`, `dd`, `mkfs`, fork bombs, etc.) before they reach the server; confirmation requires typing the object's name; separate warning for commands that risk losing SSH access; can be disabled globally or per host.
- **Error detector**: offline explanation of stderr/SSH errors in Russian and English, no LLM involved; fuzzy command suggestion on "command not found"; "Copy for question" button that masks secrets automatically.
- **Breadcrumb "where am I"**: clickable path above the terminal via shell integration, status and hotkeys for the active interactive program (vim/nano/htop/man/top/less), red color for root sessions.
- **Command catalog**: sidebar with explanations in Russian/English, cards for nano/vim/htop/man/top/less.
- **Command history and snippets**: full-text search, secret masking, global and per-host snippets, manual ordering, quick-insert hotkey.
- **Server dashboard**: CPU/RAM/disk over a separate exec channel that doesn't load the main session, color-coded thresholds, one-time health banner for problems.
- **Host export/import**: JSON format without secrets, preview before import, protection against duplicates and invalid files.
- **Multi-language support**: Russian and English UI with automatic detection from the OS locale on first launch (falls back to Russian if the system language isn't supported), manual switch in settings, localized error and command databases.
- **Auto-update**: checks for new versions via GitHub Releases, manual and automatic checks, user data preserved across updates.
- **Help**: built-in guide (F1) covering getting started, snippets, the guard, the error detector, and hotkeys.

### Security

- Passwords and passphrases go through Windows Credential Manager (keytar) only — never stored in files or logs.
- `contextIsolation` is enabled; renderer has no direct access to Node.
- Secrets in command history are masked before being saved.
- The installer ships without a code-signing certificate (no Code Signing Certificate available) — integrity is verified via the SHA-256 checksum published with each release.
