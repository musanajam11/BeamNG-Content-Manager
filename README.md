<div align="center">

<img src="build/icon.png" alt="BeamNG Content Manager" width="128" />

# BeamNG Content Manager

> **BETA** — This project is under active development. Expect breaking changes between releases.

**The all-in-one desktop manager for [BeamNG.drive](https://www.beamng.com/) and [BeamMP](https://beammp.com/)**

Manage mods, vehicles, maps, servers, friends, career saves, and more — from a single app.

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

![Screenshot](Docs/screenshots/screenshot%20(1).png)

<details>
<summary><b>View all screenshots</b></summary>
<br>

| | |
|:---:|:---:|
| ![Screenshot 2](Docs/screenshots/screenshot%20(2).png) | ![Screenshot 3](Docs/screenshots/screenshot%20(3).png) |
| ![Screenshot 4](Docs/screenshots/screenshot%20(4).png) | ![Screenshot 5](Docs/screenshots/screenshot%20(5).png) |
| ![Screenshot 6](Docs/screenshots/screenshot%20(6).png) | ![Screenshot 7](Docs/screenshots/screenshot%20(7).png) |
| ![Screenshot 8](Docs/screenshots/screenshot%20(8).png) | ![Screenshot 9](Docs/screenshots/screenshot%20(9).png) |
| ![Screenshot 10](Docs/screenshots/screenshot%20(10).png) | ![Screenshot 11](Docs/screenshots/screenshot%20(11).png) |
| ![Screenshot 12](Docs/screenshots/screenshot%20(12).png) | ![Screenshot 13](Docs/screenshots/screenshot%20(13).png) |
| ![Screenshot 14](Docs/screenshots/screenshot%20(14).png) | ![Screenshot 15](Docs/screenshots/screenshot%20(15).png) |
| ![Screenshot 16](Docs/screenshots/screenshot%20(16).png) | |

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
- **Configuration Manager** — sidebar panel listing all configs (factory + custom); create new, clone, rename, duplicate, and delete configs with confirmation dialogs
- **Config Preview** — thumbnail preview of the selected config with toggle to open the 3D Vehicle Viewer
- **Config Editor** — per-slot part selection via dropdowns populated from vehicle slot data; tuning variable sliders with labeled min/max range, default value, and engineering units; slot-type compatibility validation with allowTypes/denyTypes enforcement and default-part fallback
- **Parts List** — complete hierarchical listing of all installed parts for the active config
- **Active Mesh Calculation** — determines which meshes are visible based on the active config's part selection, supporting group-based mesh filtering and per-part mesh ownership tracking
- **3D Vehicle Viewer** — interactive Three.js model with COLLADA `.dae` loading (multi-DAE assembly for body, cargo, mechanicals), DDS texture support (BC1–BC7), material classification (paint, chrome, glass, rubber, interior), multi-zone paint system with swatchable color palette (metallic/roughness/clearcoat per zone), showroom environment (gradient + ground plane), wheel placement computed from hub node positions, and render options panel *(in development)*

</details>

### Map Browser

<details>
<summary>Explore maps with previews, metadata, and registry info</summary>

- **Map Grid** — lazy-loaded 16:9 preview images with map name overlay and stock/mod source divider
- **Search & Filter** — text search with stock vs. mod source filter
- **Map Detail View** — authors, terrain size (e.g. 2048×2048), spawn point count, world bounds, and embedded minimap display
- **Advanced Minimap Engine** — tile-based composition (terrain, island, bridge overlays with chroma-key detection, up to 6144px output), monolithic fallback with transparency handling and terrain base color blending, DecalRoad rendering with material-based road coloring (asphalt/dirt/concrete) and anti-aliased thick-line drawing, and versioned disk caching (v3 format with world bounds sidecar)
- **Registry Metadata Panel** — identifier, version, license, release status, BeamNG version compatibility (min/max), tags, authors, thumbnail, and description pulled from the mod registry
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
Pull mod metadata from configurable repositories (name, URL, priority). Verified badges (✓) for mods with confirmed authorship. Transitive dependency resolution — installs required dependencies automatically with version constraint checking. Update notifications with one-click update. Mod detail panel with identifier, version, abstract, authors, license, tags, download URL, and SHA-256 file hash. Supports multiple registries with priority-based conflict resolution.

#### Advanced Features
- **Conflict Detection** — file overlap detection across mods with load-order-based winner determination and conflict report showing affected paths
- **Load Order Management** — drag-to-reorder UI (DnD Kit) with filename prefix enforcement (e.g. `01_`, `02_`) and persistent save to config
- **Modpack System** — export selected mods as a `.beampack` JSON bundle with versions; import with conflict resolution

</details>

### Server Browser

<details>
<summary>Browse, filter, favorite, and join BeamMP servers</summary>

- **Stats Row** — 4 summary cards: total servers, total players online, servers with open slots, and your favorites count
- **Server List** — auto-refreshing (30-second polling) with BeamMP rich-text name rendering (`^0`–`^f` color codes, `^l`/`^o`/`^n`/`^m`/`^r` style codes)
- **Search & Sort** — text search with sort by players, name, map, or region; ascending/descending toggle
- **Quick Filter Chips** — toggle chips for: show empty, show full, official only, modded, password-protected
- **Filter Tabs** — All / Favorites / History / Modded / Official
- **Favorite Servers** — star toggle on any server, persisted across sessions; offline favorites are probed to refresh cached data
- **Server Detail Panel** — map preview, player list, mod list (name, type, size), server description, owner info, and connection details
- **Join & Mod Sync** — one-click join with automatic mod sync overlay showing real-time per-mod download progress and extraction status
- **Queue System** — queue for full servers with position indicator, auto-join when a slot opens, queue persistence across sessions, and configurable timeout
- **Direct Connect** — connect by IP:port for unlisted servers with saved direct-connect history
- **BeamMP Authentication** — saved auth key for seamless multiplayer access with guest mode fallback

</details>

### Server Manager (Self-Hosted)

<details>
<summary>Manage your own BeamMP server instances entirely from within the app — 8 integrated tabs</summary>

- **Instance Management** — create, duplicate, rename, and delete server instances; start/stop/restart with live status indicators
- **Auto-Download** — automatically downloads the correct BeamMP Server binary for your platform (Windows/Linux/macOS) with `chmod +x` on Unix; status banner shows ready/missing/downloading state
- **Status Tab** — at-a-glance server status (stopped/starting/running/error), uptime, player count, and resource usage
- **Config Editor** — full server settings form (max players, map, ports, auth keys) with a WYSIWYG BeamMP rich-text name editor (character-level color/style toolbar with `^0`–`^f` color codes, bold/italic/underline/strikethrough, raw mode toggle, and live preview)
- **Live Console** — real-time log output streamed from the server process with color-coded entries, command input field for sending server commands, and clear logs button
- **File Manager** — browse the server's directory tree and edit any file in-app using Monaco Editor (syntax highlighting, find/replace, minimap, save)
- **Mods Panel** — deploy or undeploy mods to the server's `Resources/Client` directory; shows mod name, type, size, and status
- **Scheduling** — create automated tasks with 7 action types (backup with max retention, restart, start/stop, custom command, chat message broadcast, mod update) across 4 frequencies (once, hourly, daily, weekly); time-of-day picker, day-of-week selector, last-run tracking with result display; backup management with restore/delete
- **Analytics** — period selector (24h/7d/30d/all), summary cards (total sessions, unique players, avg session length, peak concurrent), bar chart of player activity over time, and player table with total sessions, playtime, first/last seen, and per-session drill-down
- **Player Heat Map** — 3D WebGL terrain (512×512 heightmap) with textured ground, live player position cones (directional), density heat map overlay with configurable color ramp, and GPS route planner with road-network A\* pathfinding and ribbon visualization *(in development)*

</details>

### Friends System

<details>
<summary>Social features for tracking and playing with friends</summary>

- **5-Tab Layout** — All Friends (searchable), Online, Offline, Suggestions (recently played with), and BeamMP Friend Requests
- **Friend Management** — add by username, add from suggestions, remove with confirmation, edit notes and custom user tags
- **Online Status Tracking** — real-time status via server player list cross-reference; shows current server and map when online, last seen timestamp when offline
- **Smart Suggestions** — "recently played with" list based on session history (minimum 2 encounters), sorted by recency
- **Quick Actions** — join a friend's server, view server details, copy server IP to clipboard
- **Tailscale Integration** — detect Tailnet peers, show Tailnet-only friends, and direct VPN connection indicators

</details>

### Game Launcher

<details>
<summary>Launch singleplayer and multiplayer with protocol integration</summary>

- **Protocol Integration** — registers custom `beammp://` protocol handlers (HTTP, HTTPS, TCP, UDP) so the app can launch multiplayer sessions directly — no separate BeamMP Launcher needed
- **Singleplayer Bridge** — launches BeamNG.drive in singleplayer mode with Lua bridge injection for mod management communication
- **Multiplayer Bridge** — launches via BeamMP with auth key injection, server address passing, and mod sync
- **Steam/Proton Launch** — on Linux, launches through `steam -applaunch 284160` with Proton prefix detection
- **Log Viewer** — color-coded log output (info/warn/error/debug categories), text filter, auto-scroll with scroll-lock threshold, copy-to-clipboard, and export/download as text file
- **Auth Key Management** — saved BeamMP authentication key with validation and guest mode option
- **Auto-Kill on Join Failure** — automatically terminates BeamNG.drive when the server rejects the connection (kick, ban, full, auth error) or the connection drops during an active relay session, preventing the game from being stuck at the main menu

</details>

### Live GPS Tracking

<details>
<summary>Real-time GPS telemetry overlay during gameplay with route, POI, and multiplayer support</summary>

- **Tracker Deployment** — deploys a Lua GE extension (`beamcmGPS.lua`) to the game that writes telemetry at 20 Hz to a JSON file, read by the app via file-based IPC at 10 Hz
- **Map Auto-Detection** — automatically identifies the current map using `getMissionFilename()` with `getCurrentLevelIdentifier()` fallback; case-insensitive matching against both map name and level directory
- **2D Minimap Canvas** — overhead map rendering with world-bounds alignment, panning, and smooth zoom controls
- **Player Arrow** — orange directional arrow showing the player's real-time position and heading on the minimap
- **Speed Display** — live speed readout from vehicle telemetry
- **Navigation Route Overlay** — reads the in-game route planner path and renders it as a cyan dashed line on the minimap
- **Other Players (Multiplayer)** — displays other connected players as blue dots on the minimap in BeamMP sessions
- **Points of Interest** — renders map-specific POIs (spawn points, landmarks, facilities) with hover highlighting and labels
- **Follow Player Mode** — toggle to auto-center the camera on the player position while preserving the current zoom level
- **Zoom Controls** — zoom in/out buttons with smooth scaling
- **Stale Data Detection** — detects when telemetry data is outdated and shows a waiting indicator
- **GPS Signal Status** — visual indicators for tracker deployment state, signal acquisition, and active tracking

</details>

### Controls & Input Editor

<details>
<summary>Full input binding, force feedback, steering filter, and preset management for all devices</summary>

**Input Binding Management**
- Auto-detect connected devices: keyboard, mouse, gamepads, and steering wheels
- Per-device binding editor — view and rebind all game actions with conflict detection and resolution (replace, bind both, or swap)
- Full-text action search and reset-to-defaults per device

**Axis Configuration**
- Deadzone range control per axis
- Linearity / response curves with visual feedback
- Steering angle limits for wheel users

**Force Feedback (FFB)**
- Strength, smoothing, and response correction sliders
- Update mode selector (Fast / Smooth / Legacy)
- Low-speed force compensation toggle

**Steering Filters & Assists**
- Autocenter strength and speed-sensitive steering slowdown
- Steering rotation hard limit
- Stabilization assist (oversteer reduction) and understeer reduction

**Preset Management**
- Save, load, and delete named presets for the entire control configuration
- Export and import presets as shareable files

**Live Input Monitor**
- Real-time device polling with axis value visualization and button press state indicators

</details>

### Settings

<details>
<summary>General configuration, appearance customization, and custom CSS</summary>

**General**
- Auto-detect or manually set BeamNG.drive game paths (game directory, user folder, cache)
- Custom backend server URL with live health-check indicator; backend selection (official vs. custom) with auth URL configuration
- Configurable mod registry repositories — add multiple sources with name, URL, and priority; reorder via drag
- Default server ports and custom server executable path
- Graphics renderer selection — choose DirectX 11 or Vulkan (or prompt each launch)
- CareerMP save path override
- Modpack export (`.beampack` JSON bundle of selected mods) and import with conflict resolution

**Appearance**
- Accent color picker with 12 preset colors and custom hex input
- UI scale slider (50%–200%) and font size slider (12–20px)
- Background style selector: solid color, gradient, image, or random image rotation on launch
- Background image gallery with upload, selection, blur intensity (0–40px), and opacity control
- Surface opacity and border opacity multipliers for glass-morphism effect
- Glassmorphism blur toggle
- Sidebar width slider (160–280px)
- Sidebar page reordering via drag with per-page visibility toggles

**Custom CSS**
- Monaco editor for injecting custom CSS into the app at runtime
- Enable/disable toggle
- Pre-made snippet library: rounded scrollbar, fade-in animations, scale hover effects, glow on hover, card lift animations, uppercase headings, hide status bar, large button targets, sepia tint, custom text selection color

</details>

### CareerMP Save Manager

<details>
<summary>Browse, deploy, backup, and manage your CareerMP and RLS career saves</summary>

- **Profile Discovery** — auto-detects career profiles from BeamNG.drive cloud saves folder with configurable manual path override
- **Deploy / Undeploy** — deploy profiles to the game save folder or undeploy them to Content Manager storage; deployed profiles are visible to the game, undeployed profiles are safely stored externally
- **3-Level Navigation** — Profile List → Profile Detail (slots, deploy status, backups, career log) → Slot Detail (full stats and metadata)
- **Rich Metadata** — money, bank balance, BeamXP with level progress bar, current map, vehicle count, insurance, missions completed, odometer, drift score, stamina, vouchers
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

- **23 Languages** — English, Spanish, Portuguese, French, German, Italian, Czech, Danish, Finnish, Norwegian, Polish, Swedish, Turkish, Chinese, Japanese, Korean, Russian, Arabic, Farsi, Urdu, Lithuanian, Latvian, Bulgarian
- **RTL Support** — proper right-to-left layout for Arabic, Farsi, and Urdu
- **Complete Coverage** — all UI text, labels, buttons, messages, and descriptions are translatable
- **Language Selector** — switch language from Settings with flag icons and instant UI update

</details>

### Additional
- **System Tray** — minimizes to tray on close (Discord-style); double-click to restore; right-click menu with Show/Quit
- **Single Instance Lock** — prevents multiple app instances from running simultaneously
- **Auto-Update** — checks for updates on startup with changelog display and background download/install
- **Setup Wizard** — 4-step first-run experience: Welcome → Game Paths → Backend Configuration → Done
- **Custom Titlebar** — frameless window with custom minimize/maximize/close controls and drag region
- **Status Bar** — persistent bottom bar showing BeamNG.drive version, BeamMP Client and Server versions, and app version
- **Sidebar Navigation** — collapsible icon sidebar with tooltips, page routing, active-page indicator, and user-configurable page order and visibility
- **Tailscale Integration** — direct-connect networking via Tailscale for LAN-like multiplayer over the internet
- **Cross-Platform** — Windows (NSIS installer), Linux (AppImage + deb), macOS (DMG); Linux Proton/Steam auto-detection and launch support

---

## In Development

> [!NOTE]
> These features are functional but actively being refined.

- **3D Vehicle Viewer & Editor** — COLLADA `.dae` model loader with multi-DAE assembly (body, cargo, mechanicals) and DDS texture support (BC1–BC7 compression formats). Mesh classification identifies paint, chrome, glass, rubber, and interior surfaces. Multi-zone paint system (3 zones) with swatchable color palette, metallic/roughness/clearcoat per zone, and material defaults + config overrides. Showroom environment with gradient skybox and reflective ground plane. Wheel placement computed from hub node positions (median/midpoint/arm fallback with FR/FL/RR/RL corner detection). Render options panel for wireframe, normals, bounding boxes, and material overlays.
- **Player Heat Map** — 3D terrain visualization (512×512 heightmap) with textured ground. Live player positions displayed as directional cones. Density heat map overlay with configurable color ramp.

---

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| Framework | Electron 39 |
| Frontend | React 19, TypeScript 5.9 |
| Styling | Tailwind CSS v4 |
| State | Zustand 5 |
| Build | electron-vite 5, electron-builder 26 |
| 3D | Three.js r183 |
| Editor | Monaco Editor |
| Animations | Framer Motion 12 |
| i18n | react-i18next 17 / i18next 26 |

---

## Project Structure

```
src/
├── main/                # Electron main process
│   ├── ipc/             #   IPC handlers (~90 channels)
│   ├── services/        #   Backend services (~18 services)
│   └── utils/           #   Parsing utilities
├── preload/             # Context bridge
├── renderer/            # React frontend
│   └── src/
│       ├── components/  #   UI components
│       ├── hooks/       #   Custom React hooks
│       ├── locales/     #   20 language JSON files
│       ├── pages/       #   Page components (12 pages)
│       └── stores/      #   Zustand state stores (~8 stores)
└── shared/              # Types shared between main & renderer
build/                   # Electron-builder resources (icons)
resources/               # Bundled assets (backgrounds)
Docs/                    # Guides, screenshots, and documentation
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

### Asset Ownership & Third-Party Notices

All game assets included in or displayed by this application — including bundled background images (screenshots from BeamNG.drive®), vehicle models, maps, textures, sounds, and related media — are the exclusive property of **[BeamNG GmbH](https://www.beamng.com/)** and are **not** covered by this project's GPL-3.0 license. These assets may not be redistributed, modified, or used separately without permission from BeamNG GmbH.

This project is not affiliated with, endorsed by, or sponsored by BeamNG GmbH or the BeamMP team. All trademarks and registered trademarks are the property of their respective owners.

For full attribution details, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

### Legal Basis for Bundled Screenshot Assets

This application bundles in-game screenshots from BeamNG.drive® as default background images for the user interface. The following legal analysis establishes the basis for their inclusion.

#### 1. Underlying Game Content — BeamNG GmbH Ownership

All visual elements rendered in any BeamNG.drive® screenshot — including vehicle models, maps, textures, lighting, physics simulation, and the rendering pipeline — are the intellectual property of BeamNG GmbH. Per the [BeamNG EULA § 1 (Ownership)](https://www.beamng.com/game/support/policies/eula/):

> *"All right, title, interest and ownership rights at / in the Software and any copyright, design right, database right [...] (including but not limited to any titles, computer code, themes, objects, characters, character names, stories, text, dialog, catch phrases, locations, concepts, artwork, animations, sounds, musical compositions, audio-visual effects, moral rights and any related documentation) are owned by, belong to and vest in BeamNG or its licensors."*

BeamNG GmbH actively encourages community content creation. Per the [BeamNG FAQ — Content Creators](https://www.beamng.com/game/about/faq/):

> *"You can upload BeamNG.drive gameplay videos to YouTube and monetize them without any restrictions."*

This project's use of game screenshots as decorative backgrounds in a free, open-source community tool is consistent with BeamNG's established posture toward community content.

#### 2. Copyrightability of Game Screenshots Under US Law

The bundled screenshots are subject to US copyright law. Under [17 U.S.C. § 102](https://www.law.cornell.edu/uscode/text/17/102), copyright protects "original works of authorship." The Supreme Court established in [*Feist Publications, Inc. v. Rural Telephone Service Co.*, 499 U.S. 340 (1991)](https://supreme.justia.com/cases/federal/us/499/340/) that a work must possess a "modicum of creativity" to qualify for copyright protection.

A game screenshot's creative contribution by the capturing user is limited to:

- Camera angle selection (from a constrained in-game camera system)
- Timing of capture
- Vehicle and map selection (from a fixed set of options)

All other visual elements — 3D models, textures, environments, lighting, rendering, and physics simulation — are created entirely by BeamNG GmbH and its engine. The **scènes à faire** doctrine, as applied by the Supreme Court in [*Google LLC v. Oracle America, Inc.*, 593 U.S. 1 (2021)](https://supreme.justia.com/cases/federal/us/593/18-956/), holds that creative choices dictated or heavily constrained by the medium or context do not receive copyright protection. A screenshot of a vehicle on a road in a driving simulator is the natural and expected output of using the software.

#### 3. Fair Use — [17 U.S.C. § 107](https://www.law.cornell.edu/uscode/text/17/107)

Even if a screenshot were to receive thin copyright protection, the inclusion of these images in this project constitutes fair use under the four statutory factors:

| Factor | Analysis |
|--------|----------|
| **(1) Purpose and character of use** | Functional and decorative use in a free, open-source community tool. The screenshots serve as UI backgrounds — a transformative purpose distinct from their original creation as gameplay captures or social media posts. Not used for commercial gain. |
| **(2) Nature of the copyrighted work** | Game screenshots are functional captures of a pre-existing software product, not highly creative original works. The underlying creative content (vehicles, environments) is owned by BeamNG GmbH, not the screenshot author. |
| **(3) Amount and substantiality** | Individual images are used in their entirety, which is necessary for their functional purpose as backgrounds. This factor is mitigated when the use is transformative ([*Google LLC v. Oracle America, Inc.*, 593 U.S. 1 (2021)](https://supreme.justia.com/cases/federal/us/593/18-956/)). |
| **(4) Effect on the market** | No market exists for individual BeamNG gameplay screenshots. Inclusion as application backgrounds does not substitute for or diminish the value of the original screenshots in any market. |

#### 4. DMCA Compliance — [17 U.S.C. § 512](https://www.law.cornell.edu/uscode/text/17/512)

This project maintains a good-faith takedown commitment. If any rights holder objects to the inclusion of a specific asset, it will be removed promptly upon notification. Contact information is provided in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

#### 5. Trademark Usage — Referential Use

Per the [BeamNG Trademark Usage Guidelines § 1](https://www.beamng.com/game/support/policies/trademark-guidelines/):

> *"Third parties may use the word trademarks of BeamNG to reference BeamNG's software, technologies, and services ('Referential Use')."*

All references to "BeamNG.drive®" in this project are referential use to identify the source of the bundled assets. BeamNG.drive® is a registered trademark of BeamNG GmbH (EU trademark No. 018 357 678).

#### References

| Source | Citation |
|--------|----------|
| BeamNG EULA | [beamng.com/game/support/policies/eula](https://www.beamng.com/game/support/policies/eula/) |
| BeamNG Terms of Service | [beamng.com/game/support/policies/terms-of-service](https://www.beamng.com/game/support/policies/terms-of-service/) |
| BeamNG Trademark Guidelines | [beamng.com/game/support/policies/trademark-guidelines](https://www.beamng.com/game/support/policies/trademark-guidelines/) |
| BeamNG FAQ | [beamng.com/game/about/faq](https://www.beamng.com/game/about/faq/) |
| US Copyright Act, 17 U.S.C. § 102 | [law.cornell.edu/uscode/text/17/102](https://www.law.cornell.edu/uscode/text/17/102) |
| US Copyright Act, 17 U.S.C. § 107 (Fair Use) | [law.cornell.edu/uscode/text/17/107](https://www.law.cornell.edu/uscode/text/17/107) |
| US Copyright Act, 17 U.S.C. § 512 (DMCA) | [law.cornell.edu/uscode/text/17/512](https://www.law.cornell.edu/uscode/text/17/512) |
| *Feist v. Rural*, 499 U.S. 340 (1991) | [supreme.justia.com/cases/federal/us/499/340](https://supreme.justia.com/cases/federal/us/499/340/) |
| *Google v. Oracle*, 593 U.S. 1 (2021) | [supreme.justia.com/cases/federal/us/593/18-956](https://supreme.justia.com/cases/federal/us/593/18-956/) |

---

<div align="center">

**[BeamNG.drive](https://www.beamng.com/)** by BeamNG GmbH · **[BeamMP](https://beammp.com/)** multiplayer mod · Built with **[electron-vite](https://electron-vite.org/)**

</div>
