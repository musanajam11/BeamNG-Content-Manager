<div align="center">

<img src="build/icon.png" alt="BeamNG Content Manager" width="128" />

# BeamNG Content Manager

> **BETA** — This project is under active development. Expect breaking changes between releases.

**The all-in-one desktop manager for [BeamNG.drive](https://www.beamng.com/) and [BeamMP](https://beammp.com/)**

Manage mods, vehicles, maps, servers, and more — from a single app.

[![Build & Release](https://github.com/musanajam11/BeamNG-Content-Manager/actions/workflows/build.yml/badge.svg)](https://github.com/musanajam11/BeamNG-Content-Manager/actions/workflows/build.yml)
[![Beta](https://img.shields.io/badge/Status-Beta-orange)](https://github.com/musanajam11/BeamNG-Content-Manager/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[**Download**](https://github.com/musanajam11/BeamNG-Content-Manager/releases/latest) · [**Build from Source**](docs/BUILD.md) · [**Report Bug**](https://github.com/musanajam11/BeamNG-Content-Manager/issues) · [**Request Feature**](https://github.com/musanajam11/BeamNG-Content-Manager/issues)

</div>

---

## Screenshots

<div align="center">

![Screenshot](docs/screenshots/screenshot%20(1).png)

<details>
<summary><b>View all screenshots</b></summary>
<br>

| | |
|:---:|:---:|
| ![Screenshot 2](docs/screenshots/screenshot%20(2).png) | ![Screenshot 3](docs/screenshots/screenshot%20(3).png) |
| ![Screenshot 4](docs/screenshots/screenshot%20(4).png) | ![Screenshot 5](docs/screenshots/screenshot%20(5).png) |
| ![Screenshot 6](docs/screenshots/screenshot%20(6).png) | ![Screenshot 7](docs/screenshots/screenshot%20(7).png) |
| ![Screenshot 8](docs/screenshots/screenshot%20(8).png) | ![Screenshot 9](docs/screenshots/screenshot%20(9).png) |
| ![Screenshot 10](docs/screenshots/screenshot%20(10).png) | ![Screenshot 11](docs/screenshots/screenshot%20(11).png) |
| ![Screenshot 12](docs/screenshots/screenshot%20(12).png) | ![Screenshot 13](docs/screenshots/screenshot%20(13).png) |
| ![Screenshot 14](docs/screenshots/screenshot%20(14).png) | ![Screenshot 15](docs/screenshots/screenshot%20(15).png) |
| ![Screenshot 16](docs/screenshots/screenshot%20(16).png) | |

</details>

</div>

---

## Installation

### Windows (Recommended)

> Download the latest installer from [**Releases**](https://github.com/musanajam11/BeamNG-Content-Manager/releases):

| Platform | File | Notes |
|----------|------|-------|
| Windows | `beamng-content-manager-*-setup.exe` | NSIS installer, auto-updates |
| Linux | `beamng-content-manager-*.AppImage` | Portable, no install needed |
| Linux (Debian) | `beamng-content-manager-*.deb` | `sudo dpkg -i <file>.deb` |
| macOS | `beamng-content-manager-*.dmg` | Drag to Applications |

> [!TIP]
> On Windows, the installer creates a desktop shortcut and Start Menu entry automatically. The app minimizes to the system tray when closed — right-click the tray icon to quit.

<details>
<summary><b>Build from source instead</b></summary>

See the full [Build Guide](docs/BUILD.md) for prerequisites and step-by-step instructions.

```bash
git clone https://github.com/musanajam11/BeamNG-Content-Manager.git
cd BeamNG-Content-Manager
npm install
npm run build:win    # or build:linux / build:mac
```

</details>

---

## Features

### Dashboard
- **Singleplayer Launch** — one-click launch with live game status indicator; shows warning when game path is not configured
- **Registry Update Banner** — detects available mod updates from configured registries and prompts to update
- **Favorite Servers** — 3-column grid (up to 6) with map preview backgrounds, server name with BeamMP rich-text rendering, player count badges, and password lock indicators
- **Recent Servers** — 4-column grid of recently joined servers with the same card style
- **Recently Installed Mods** — 3-column grid (up to 6) showing thumbnail, mod name, author, file size, and relative install time (e.g. "2 hours ago")
- **News Feed** — aggregated feed (4 items) from Steam and BeamMP sources with source badges, timestamps, and external links

### Vehicle Browser

<details>
<summary>Browse, inspect, and customize every vehicle in your game</summary>

- **Vehicle Grid** — lazy-loaded thumbnails (batches of 12) with infinite scroll, shows vehicle name and config count badge
- **Search & Filter** — text search with brand dropdown filter and stock/mod source divider
- **Vehicle Detail Panel** — brand, body style, model year, country of origin, drivetrain, power, torque, weight, fuel type, transmission
- **Performance Stats** — estimated top speed, 0–60 time, and value
- **Configuration Manager** — sidebar panel (fixed 16rem width) listing all configs (factory + custom); create new, clone, rename, duplicate, and delete configs with confirmation dialogs
- **Config Preview** — thumbnail preview of the selected config with toggle to open the 3D Vehicle Viewer
- **Config Editor** — per-slot part selection via dropdowns populated from vehicle slot data; tuning variable sliders with labeled min/max range, default value, and engineering units
- **Parts List** — complete hierarchical listing of all installed parts for the active config
- **3D Vehicle Viewer** — interactive Three.js model with COLLADA `.dae` loading, DDS texture support (BC1–BC7), material classification (paint, chrome, glass, rubber, interior), paint system with color palette, showroom environment (gradient + ground plane), and wheel placement from node data *(in development)*

</details>

### Map Browser

<details>
<summary>Explore maps with previews, metadata, and registry info</summary>

- **Map Grid** — lazy-loaded 16:9 preview images with map name overlay and stock/mod source divider
- **Search & Filter** — text search with stock vs. mod source filter
- **Map Detail View** — authors, terrain size (e.g. 2048×2048), spawn point count, world bounds, and embedded minimap display
- **Registry Metadata Panel** — identifier, version, license, release status, compatibility info, and description pulled from the mod registry
- **External Links** — links to mod page, repository, or documentation when available

</details>

### Mod Manager

<details>
<summary>Three tabs for complete mod lifecycle management</summary>

#### Installed
Stats grid showing total mods, total disk usage, active count, and last scan time. Table view with columns for name, author, type, size, and status. Enable/disable toggles per mod. Delete with dependency-check confirmation. Type filter dropdown (vehicle, map, ui, general, etc.) and text search. Full metadata side panel with registry enrichment (description, tags, version, authors, license).

#### Browse (beamng.com)
OAuth login via BeamNG.com for access to the official mod repository. Category filter (vehicles, maps, props, UI, etc.), sort by relevance/date/downloads/rating with ascending/descending toggle, paginated results. Star ratings, download counts, and file size displayed per mod. One-click install with real-time progress bar and automatic extraction.

#### Registry (CKAN-style)
Pull mod metadata from configurable repositories (name, URL, priority). Verified badges (✓) for mods with confirmed authorship. Transitive dependency resolution — installs required dependencies automatically. Update notifications with one-click update. Mod detail panel with identifier, version, abstract, authors, license, download URL, and file hash. Supports multiple registries with priority-based conflict resolution.

</details>

### Server Browser

<details>
<summary>Browse, filter, favorite, and join BeamMP servers</summary>

- **Stats Row** — 4 summary cards: total servers, total players online, servers with open slots, and your favorites count
- **Server List** — auto-refreshing (30-second polling) with BeamMP rich-text name rendering (`^0`–`^f` color codes, `^l`/`^o`/`^n`/`^m`/`^r` style codes)
- **Search & Sort** — text search with sort by players, name, map, or region; ascending/descending toggle
- **Quick Filter Chips** — toggle chips for: show empty, show full, official only, modded, password-protected
- **Filter Tabs** — All / Favorites / History / Modded / Official
- **Favorite Servers** — star toggle on any server, persisted across sessions
- **Server Detail Panel** — map name starting with a preview, player list, mod list, server description, owner info, and connection details
- **Join & Queue** — one-click join with automatic mod sync overlay (downloads/updates required mods); queue system for full servers with auto-join when a slot opens and a queue position overlay
- **Direct Connect** — connect by IP:port for unlisted servers
- **BeamMP Authentication** — saved auth key for seamless multiplayer access

</details>

### Server Manager (Self-Hosted)

<details>
<summary>Manage your own BeamMP server instances entirely from within the app</summary>

- **Instance Management** — create, duplicate, rename, and delete server instances; start/stop/restart with live status indicators
- **Auto-Download** — automatically downloads the correct BeamMP Server binary for your platform (Windows/Linux/macOS) with `chmod +x` on Unix
- **Status Tab** — at-a-glance server status, uptime, player count, and resource usage
- **Config Editor** — full server settings form with a WYSIWYG BeamMP rich-text name editor (character-level color/style toolbar with `^0`–`^f` color codes, bold/italic/underline/strikethrough, raw mode toggle, and live preview)
- **Live Console** — real-time log output streamed from the server process with command input field for sending server commands
- **File Manager** — browse the server's directory tree and edit any file in-app using Monaco Editor (syntax highlighting, find/replace, minimap)
- **Mods Panel** — deploy or undeploy mods to the server's `Resources/Client` directory; shows mod name, type, size, and status
- **Scheduling** — create automated tasks with 7 action types (backup, restart, command, chat message, mod update, config change, script) across 4 frequencies (once, hourly, daily, weekly); backup management with restore/delete
- **Analytics** — period selector (24h/7d/30d/all), summary cards (total sessions, unique players, avg session length, peak concurrent), bar chart of player activity over time, and player table with session drill-down
- **Player Heat Map** — 3D WebGL terrain (512×512) with live player position cones, density heat map overlay, and GPS route planner with road-following pathfinding *(in development)*

</details>

### Game Launcher

<details>
<summary>Launch singleplayer and multiplayer with protocol integration</summary>

- **Protocol Integration** — registers custom `beammp://` protocol handlers (HTTP, HTTPS, TCP, UDP) so the app can launch multiplayer sessions directly — no separate BeamMP Launcher needed
- **Singleplayer Bridge** — launches BeamNG.drive in singleplayer mode with Lua bridge injection for mod management communication
- **Multiplayer Bridge** — launches via BeamMP with auth key injection, server address passing, and mod sync
- **Steam/Proton Launch** — on Linux, launches through `steam -applaunch 284160` with Proton prefix detection
- **Log Viewer** — color-coded log output (info/warn/error/debug categories), text filter, auto-scroll with scroll-lock threshold, copy-to-clipboard, and export/download as text file
- **Auth Key Management** — saved BeamMP authentication key with validation

</details>

### Settings

<details>
<summary>General configuration and appearance customization</summary>

**General**
- Auto-detect or manually set BeamNG.drive game paths (game directory, user folder, cache)
- Custom backend server URL with live health-check indicator
- Configurable mod registry repositories — add multiple sources with name, URL, and priority; reorder via drag
- Modpack export (`.beampack` JSON bundle of selected mods) and import with conflict resolution

**Appearance**
- Accent color picker with 12 preset colors and custom hex input
- UI scale slider (50%–200%) and font size slider
- Background style selector: solid color, gradient, image, or random image rotation
- Background image gallery with upload and selection
- Surface opacity slider for glass-morphism effect
- Background blur intensity toggle
- Sidebar width adjustment

</details>

### CareerMP Save Manager

<details>
<summary>Browse, deploy, backup, and manage your CareerMP and RLS career saves</summary>

- **Profile Discovery** — auto-detects career profiles from BeamNG.drive cloud saves folder with configurable manual path override
- **Deploy / Undeploy** — deploy profiles to the game save folder or undeploy them to Content Manager storage; deployed profiles are visible to the game, undeployed profiles are safely stored externally
- **3-Level Navigation** — Profile List → Profile Detail (slots, deploy status, backups, career log) → Slot Detail (full stats and metadata)
- **Rich Metadata** — money, BeamXP with level progress bar, current map, vehicle count, insurance, missions completed, odometer, drift score, stamina, vouchers
- **Skills & Activities** — expandable skill categories (logistics, BMRA, freestyle, career skills, APM) with subcategory breakdown
- **Business Reputations** — reputation bars for all dealerships and businesses with value/max display
- **Vehicle Gallery** — thumbnail grid of all owned vehicles with model names and preview images
- **Profile Backups** — full profile backup to Content Manager storage with restore and delete; per-slot backups also supported
- **Career Activity Log** — view the career log file with most recent entries first
- **RLS Support** — detects RLS (Real Life Simulator) profiles with bank balance and credit score display

</details>

### Internationalization (i18n)

<details>
<summary>Full multi-language support across the entire app</summary>

- **13 Languages** — English, Spanish, Portuguese, French, German, Italian, Chinese, Japanese, Korean, Russian, Arabic, Farsi, Urdu
- **RTL Support** — proper right-to-left layout for Arabic, Farsi, and Urdu
- **Complete Coverage** — all UI text, labels, buttons, messages, and descriptions are translatable
- **Language Selector** — switch language from Settings with instant UI update

</details>

### Additional
- **System Tray** — minimizes to tray on close (Discord-style); double-click to restore; right-click menu with Show/Quit
- **Single Instance Lock** — prevents multiple app instances from running simultaneously
- **Setup Wizard** — 4-step first-run experience: Welcome → Game Paths → Backend Configuration → Done
- **Custom Titlebar** — frameless window with custom minimize/maximize/close controls and drag region
- **Status Bar** — persistent bottom bar showing BeamNG.drive version, BeamMP Client and Server versions, and app version
- **Sidebar Navigation** — collapsible icon sidebar with tooltips, page routing, and active-page indicator
- **Tailscale Integration** — direct-connect networking via Tailscale for LAN-like multiplayer over the internet
- **Cross-Platform** — Windows (NSIS installer), Linux (AppImage + deb), macOS (DMG); Linux Proton/Steam auto-detection and launch support

---

## In Development

> [!NOTE]
> These features are functional but actively being refined.

- **3D Vehicle Viewer & Editor** — COLLADA `.dae` model loader with DDS texture support (BC1–BC7 compression formats). Mesh classification identifies paint, chrome, glass, rubber, and interior surfaces. Paint system with swatchable color palette applies to classified paint meshes. Showroom environment with gradient skybox and reflective ground plane. Wheel placement computed from hub node positions in vehicle data. Render options panel for wireframe, normals, bounding boxes, and material overlays.
- **Player Heat Map** — 3D terrain visualization (512×512 heightmap) with textured ground. Live player positions displayed as directional cones. Density heat map overlay with configurable color ramp. GPS route planner with road-network pathfinding and ribbon visualization.

---

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| Framework | Electron 39 |
| Frontend | React 19, TypeScript 5.9 |
| Styling | Tailwind CSS v4 |
| State | Zustand 5 |
| Build | electron-vite 5, electron-builder |
| 3D | Three.js |
| Editor | Monaco Editor |
| Animations | Framer Motion |

---

## Project Structure

```
src/
├── main/                # Electron main process
│   ├── ipc/             #   IPC handlers
│   ├── services/        #   Backend services (15 services)
│   └── utils/           #   Parsing utilities
├── preload/             # Context bridge
├── renderer/            # React frontend
│   └── src/
│       ├── components/  #   UI components
│       ├── hooks/       #   Custom React hooks
│       ├── pages/       #   Page components (10 pages)
│       └── stores/      #   Zustand state stores
└── shared/              # Types shared between main & renderer
build/                   # Electron-builder resources (icons)
resources/               # Bundled assets (backgrounds)
docs/                    # Guides and documentation
```

---

## Code Signing

> [!WARNING]
> **The Windows installer is not yet code-signed.** Microsoft Defender SmartScreen may display a warning stating _"Windows protected your PC"_ when you run the installer. This is expected for unsigned software and does not indicate a security threat.
>
> **This installer is safe to use.** To proceed, click **"More info"** → **"Run anyway"**. You may also need to allow the installer through your antivirus software.

**Seeking SignPath.io EV Code Signing via HSM**

We are in the process of applying for a free [SignPath Foundation](https://signpath.org/) EV code signing certificate issued via Hardware Security Module (HSM). Once granted, all Windows release binaries will be automatically signed through our GitHub Actions CI pipeline, and SmartScreen warnings will no longer appear.

SignPath's open-source program requires demonstrable project reputation — usage data such as download counts, community adoption, and historical use. As this project grows and accumulates sufficient proof of use and trust, we will complete the application and enable automated signing.

You can verify the integrity of any release by checking the SHA256 checksums published alongside each [GitHub Release](https://github.com/musanajam11/BeamNG-Content-Manager/releases), or by auditing the [build workflow](.github/workflows/build.yml) that produces the artifacts directly from this repository.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

> [!IMPORTANT]
> **Branch rules for `main`:**
> - All changes must go through a **Pull Request** — direct pushes are not allowed
> - PRs require **1 approving review** (stale approvals are dismissed on new pushes)
> - All **3 CI checks** (Windows, Linux, macOS) must pass before merging
> - PRs must be **up-to-date** with `main` before merging
> - Force pushes and branch deletion on `main` are disabled
> - **Squash merge** is the default merge strategy

See [Build Guide](docs/BUILD.md) for development setup.

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

---

<div align="center">

**[BeamNG.drive](https://www.beamng.com/)** by BeamNG GmbH · **[BeamMP](https://beammp.com/)** multiplayer mod · Built with **[electron-vite](https://electron-vite.org/)**

</div>
