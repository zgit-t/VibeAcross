# VibeAcross

**English** | [简体中文](./README.zh-CN.md)

VibeAcross is a **local-first desktop workspace manager** for developers who build software together with AI coding tools ("vibe coding"). It keeps your local projects, the AI coding tools installed on your machine, your tasks, and your work contexts in one place.

All data is stored **locally** in a SQLite database on your own computer. There is no server, no account, no cloud sync, and no built-in LLM API.

> **Status:** pre-release (`v0.2.0`). No prebuilt installers are published yet — build from source (see [Installation](#installation)).

## Why VibeAcross exists

When you use more than one AI coding tool — a terminal agent, an IDE assistant, a desktop app — each one keeps its own projects, tasks, and history. Switching tools means finding the right folder, the right tool, and the right context all over again.

VibeAcross is a single local hub that:

- Detects the AI coding tools already installed on this machine.
- Registers local project folders and remembers each project's default tool.
- Tracks development tasks per project.
- Saves **work contexts** (project + tool + task) that you can reopen later.
- Creates, lists, resumes, and renames **native AI sessions** where the tool provides a genuinely supported mechanism — and plainly marks what is **not supported** or **not yet verified**.

### Design goals

- **Local-first.** No remote server, no accounts, no cloud sync, no telemetry, no LLM calls.
- **Honest capabilities.** The app never invents command-line flags or APIs. Anything unconfirmed is shown as "not verified" instead of being presented as working.
- **Safe process launching.** Tools are launched with structured argument arrays and an explicit working directory — never by concatenating shell strings.
- **No silent actions.** The app does not silently switch tools, silently create a new session, or delete native conversations without your consent.

## Core features

- **Project management** — Import local project folders, give them a name and notes, set a default tool, open them in the system file explorer, or copy their path.
- **Project health** — Check whether a project folder still exists and whether its default tool is ready, and relocate a moved folder without touching your source files.
- **AI tool detection & configuration** — Detect six built-in tools via `PATH`, common install directories, Windows uninstall registry entries, and shortcuts; add or manually configure a custom tool when automatic detection is not reliable.
- **Tasks** — Per-project tasks with title, description, status, priority, and due date.
- **Work contexts (Sessions page)** — Save a project + tool + task combination and restore it later. Level-1 restore reopens the project directory and the selected tool.
- **Native AI sessions** — In a project's detail view, create / list / resume / rename sessions for tools that support it, with a per-tool capability matrix shown in the UI.
- **Global search** — Open the read-only search with `Ctrl/Cmd + K` and search project names/notes, task titles/descriptions, and work context names. Project source files are **not** indexed or scanned.
- **Backup & restore** — Create a single-file, self-contained database backup (`.vibeacross-backup`) and restore from it. A protective backup is kept automatically before a restore.
- **Themes & languages** — Light / Dark / Follow system, and a Simplified Chinese (zh-CN) / English (en-US) interface.

## Supported AI tools

VibeAcross ships with built-in definitions for six tools. Detection and configuration work for all of them; **native session operations depend on each tool providing a real, verified mechanism**, so they differ per tool.

| Tool | Type | Launch project | Create session | List sessions | Resume session | Rename session |
| --- | --- | --- | --- | --- | --- | --- |
| **OpenCode** | CLI | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Claude Code** | CLI | ✅ | ✅ | ❌ | ✅ | ❌ |
| **OpenAI Codex CLI** | CLI | ✅ | ⚠️ not verified | ⚠️ not verified | ⚠️ not verified | ⚠️ not verified |
| **Cursor** | Desktop | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Trae** | Desktop | ✅ | ❌ | ❌ | ❌ | ❌ |
| **WorkBuddy** | Desktop | ✅ * | ❌ | ❌ | ❌ | ❌ |

Legend: ✅ supported and verified on Windows · ❌ not supported by the tool · ⚠️ supported by the tool's official CLI but **not verified here**.

Notes:

- **Launch project** means opening the project directory with the tool: CLI tools start with the project as the working directory; Cursor and Trae open the folder directly. For **WorkBuddy** `*`, the app starts with the project as the working directory only — the official app exposes no public "open this folder" argument, so you select the working directory inside WorkBuddy yourself.
- **OpenCode** native sessions are end-to-end verified: create / list / resume / rename.
- **Claude Code** supports `claude --session-id <uuid>` to create and `claude --resume <id>` to resume (verified). It provides no machine-readable history listing and no rename for existing sessions.
- **Cursor / Trae / WorkBuddy** are desktop applications without a public CLI session interface, so native session actions are not offered.
- Only **session metadata** (IDs, titles, directories, timestamps) is read. VibeAcross never reads or stores conversation content, and never reads or modifies any tool's private database.
- A custom tool can be added through the Tools page; its native session support is marked "not verified" unless a mechanism is confirmed.

## System requirements

**To run a built app:**

- Windows 10 or Windows 11 (x64).
- Microsoft Edge WebView2 Runtime — preinstalled on Windows 11, and on most updated Windows 10 systems (otherwise install it from Microsoft).

**To build from source, you additionally need:**

- Node.js 20 or newer (22+ recommended) and npm.
- Rust (stable, minimum 1.77.2) with the default `x86_64-pc-windows-msvc` toolchain.
- Microsoft C++ Build Tools with the "Desktop development with C++" workload (the linker for Rust on Windows).

VibeAcross is currently **Windows-only**. Tool detection uses the Windows registry and Windows shortcut handling.

## Installation

There are no published binaries yet, so build from source.

```bash
# 1. Clone the repository
git clone https://github.com/zgit-t/VibeAcross.git
cd VibeAcross

# 2. Install frontend dependencies
npm install

# 3. Build the desktop app and installers
npm run tauri:build
```

Build output (`src-tauri/target/release/`):

- The runnable application: `vibeacross.exe`
- Installers under `src-tauri/target/release/bundle/`:
  - `msi/VibeAcross_0.2.0_x64_zh-CN.msi`
  - `nsis/VibeAcross_0.2.0_x64-setup.exe`

The installer contains only what is needed to run the app; it does not include source code, development databases, or temporary files. Installing or uninstalling does not touch your data in `%APPDATA%\com.vibeacross.app`.

For a development run instead of a packaged build, see [Development](#development).

## First launch

1. Start VibeAcross. On first run it creates a local SQLite database automatically (see [Where is my data?](#where-is-my-data)).
2. Open **Tools** to see which of the six built-in tools were detected on this machine. If a tool is missing or detected unreliably, click **Add tool** and provide either its executable path or its command name.
3. Optionally open **Settings** to choose your interface language, theme, default project folder, and default development tool.

No AI tool needs an account or API key configured inside VibeAcross — the app only launches tools that you have already installed and signed in to.

## Usage

### Create a project

1. Go to **Projects** → **Add project**.
2. Select a local folder, optionally set a name, notes, and a default tool, then save.
3. Open a project's detail view to see its path, health status, tasks, and native sessions.

### Check and repair a project

- Use **Recheck** in the **Project health** section to verify the folder and the default tool.
- If the folder moved, use **Relocate** to point the project at the new location. VibeAcross only updates its record; it never moves, copies, or deletes your source files.

### Launch a tool

- From a project's detail view, choose a tool and click **Launch**. CLI tools open in the project directory; desktop tools open as usual.
- A tool can only be launched when it is detected/configured and its project folder is valid.

### Create and resume native sessions

1. In a project's detail view, open the **Run session** section.
2. Pick a tool. The session list reloads for that tool, and the tool's **native session capabilities** (Create / List / Restore / Rename) are shown as Supported, Unsupported, or Not verified.
3. **Create & open** starts a new native session (only when Create is supported).
4. **Continue session** resumes a listed session in its native form.
5. **Rename** changes the display name stored in VibeAcross. Optionally also rename the title inside the tool when that is supported. Renaming never changes the native session ID.
6. **Delete local record** removes only VibeAcross's record; it does not delete the native conversation.

### Tasks

Go to **Tasks** to create and edit tasks (title, description, status, priority, due date). Tasks are always attached to a project.

### Work contexts (Sessions page)

The **Sessions** page lists saved **work contexts** (project + tool + task). You can restore one to reopen the project directory with the selected tool. To show the most recent context on the Overview page at startup, enable **Show the last work context on startup** in Settings; automatic restore on startup is a separate opt-in and is off by default.

### Search

Press `Ctrl/Cmd + K` (or use the sidebar search) to open global search across projects, tasks, and work contexts. Results are grouped and support keyboard navigation.

## Configuration

Open **Settings** to change:

- **Interface language** — Simplified Chinese (zh-CN) or English (en-US).
- **Theme** — Light / Dark / System.
- **Default project folder** — the starting location when creating projects.
- **Default development tool** — the preferred tool when opening a project.
- **Recovery** — show the last work context on startup, and optionally auto-restore it on startup.
- **Data backup & restore** — create and restore database backups.
- **Data directory** — view where the database is stored.

## Frequently asked questions

### Where is my data?

In a local SQLite database at `%APPDATA%\com.vibeacross.app\vibeacross.db`. The schema is managed by migrations under `src-tauri/migrations/` and tracked in `PRAGMA user_version`. To reset, close the app and delete the `vibeacross.db*` files in that folder.

### Does VibeAcross send any data anywhere?

No. There is no remote server, account, cloud sync, telemetry, or LLM API. Tool detection is entirely local and never uploads paths or environment variables.

### Do I need the AI tools installed?

For launching and native sessions, yes — VibeAcross detects and launches tools you have already installed. You can also register a custom tool manually by path or command name.

### Why does a tool show "Not verified"?

Because its official mechanism could not be confirmed on this machine. VibeAcross deliberately does not offer unverified actions rather than guessing flags.

### Can VibeAcross switch tools for me automatically?

No. It never silently switches tools or creates sessions. You always choose the tool.

### Does the backup include my source code?

No. A backup contains only the application database (projects, tasks, tool configs, work contexts, settings) — never source files, tokens, or passwords.

### Why don't I see a feature I read about?

Anything not listed in [Core features](#core-features) and [Supported AI tools](#supported-ai-tools) is not implemented. The app does not ship placeholder or demo data.

## Known limitations

- **Windows only** (Windows 10/11, x64).
- **No prebuilt releases yet** — you must build from source.
- **Per-tool session support varies.** Only OpenCode has full native session support; Claude Code supports create/resume but not history listing or rename; Codex CLI is supported by its official CLI but has not been verified here; desktop tools (Cursor, Trae, WorkBuddy) expose no CLI session interface.
- **WorkBuddy** launches with the project as the working directory only — no public "open this folder" argument exists, so folder selection happens inside the app, and work-context auto-open is not available for it.
- Only **session metadata** is handled; conversation content is never read or stored, and no tool's private database is read or modified.
- **No cloud sync or automatic scheduled backups.** Backup/restore is manual and single-file; after a restore, the interface reloads automatically.
- **No packaged-app click-through testing** has been performed; coverage is via type checking, production builds, unit/component tests, and backend integration tests.

## Development

### Prerequisites

See [System requirements](#system-requirements). Install Node.js 20+, Rust (stable, ≥ 1.77.2), and the Microsoft C++ Build Tools. Verify with:

```powershell
node --version
rustc --version
cargo --version
```

### Install and run

```bash
npm install

# Browser-only preview of the frontend (no Rust backend)
npm run dev

# Full desktop dev window (requires Rust)
npm run tauri:dev
```

`tauri:dev` runs `npm run dev` (Vite on port 1420) first, then loads it in the desktop window.

### Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server (browser mode) |
| `npm run build` | Type-check and build the frontend for production |
| `npm run preview` | Preview the production frontend build |
| `npm run typecheck` | TypeScript strict type check |
| `npm run test` | Frontend unit tests (Vitest + Testing Library) |
| `npm run test:watch` | Frontend tests in watch mode |
| `npm run tauri:dev` | Start the Tauri desktop dev window |
| `npm run tauri:build` | Build the Tauri desktop app and installers |

Backend (run from `src-tauri/`):

```bash
cargo check      # Compile check
cargo test       # Integration tests (migrations, projects, tools, sessions, etc.)
cargo clippy     # Lints
```

### Project layout

- `src/` — React + TypeScript frontend (`pages/`, `components/`, `features/`, `services/`, `types/`, `i18n/`).
- `src-tauri/` — Rust backend and Tauri configuration (`src/`, `migrations/`, `tauri.conf.json`).
- `public/`, `index.html` — Vite entry assets.

### Coding conventions (summary)

- TypeScript strict mode; do not disable type checking to silence errors.
- Business data is read and written only through the Rust backend via `src/services/`; the frontend never touches SQLite directly.
- Styles use CSS design tokens (`src/styles/tokens.css`) and CSS Modules; no extra styling framework.
- Tool launching goes through the controlled Rust backend with structured arguments — never a shell string.
- Add a new migration file instead of editing an existing one.

### Local data during development

The runtime database is created automatically at `%APPDATA%\com.vibeacross.app\vibeacross.db`. SQLite databases and runtime data are gitignored and must never be committed.

## Contributing

Contributions are welcome.

1. Fork the repository and create a feature branch.
2. Follow the conventions above and keep changes focused and reviewable.
3. Run the checks before opening a pull request:

   ```bash
   npm run typecheck
   npm run test
   npm run build

   cd src-tauri
   cargo test
   cargo clippy
   ```

4. Do not commit user data, machine-specific paths, personal configuration, databases, or secrets.
5. Describe in your pull request what you changed and how you verified it.

If you add support for a tool or a launch/restore method, declare it explicitly in `src-tauri/src/tools/catalog.rs` and add tests. Present unverified capabilities honestly rather than as working.

Issues and pull requests: <https://github.com/zgit-t/VibeAcross>

## License

No open-source license has been declared for this project yet. Until a license is added, the default copyright applies and no permission is granted to use, modify, or distribute the code. If you plan to reuse it, please open an issue to ask the maintainers to choose a license.
