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

[![Try the Demo](https://img.shields.io/badge/%F0%9F%8E%AE_Try_the_Demo-Live_Preview-blueviolet?style=for-the-badge&logoColor=white)](https://musanajam11.github.io/BeamNG-Content-Manager/)

</div>

---

## Screenshots

<div align="center">

<img src="docs/screenshots/Home.jpg" alt="Home Dashboard" width="880" />

<sub><i>One hub for your whole BeamNG + BeamMP setup</i></sub>

<br><br>

<details>
<summary><b>Browse the full gallery</b></summary>

<br>

### Servers

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/server-list.jpg" alt="Server browser" /><br>
      <sub><b>Server browser</b> — live list with filters &amp; favorites</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/Servers-overview.jpg" alt="Self-hosted servers" /><br>
      <sub><b>Self-hosted servers</b> — every instance in one panel</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/Servers-server.jpg" alt="Server detail" /><br>
      <sub><b>Server detail</b> — status, players, console, logs</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/Servers-server-config.jpg" alt="Server config editor" /><br>
      <sub><b>Config editor</b> — typed form over ServerConfig.toml</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/Servers-server-scheduler.jpg" alt="Scheduler" /><br>
      <sub><b>Scheduler</b> — cron-style restarts &amp; announcements</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/Servers-mods.jpg" alt="Server mods" /><br>
      <sub><b>Server mods</b> — drag-drop deploy to each instance</sub>
    </td>
  </tr>
</table>

### Coop World Editor

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/CoopEditor0.png" alt="Host a coop session" /><br>
      <sub><b>Host a session</b> — one click starts the relay &amp; launches the editor</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/CoopEditor1.png" alt="Live session" /><br>
      <sub><b>Live session</b> — invite code, peers, live op stats</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/CoopEditor2.png" alt="In-game sync" /><br>
      <sub><b>In-game</b> — remote cursor &amp; edits mirrored in real time</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/CoopEditor3.png" alt="Peer presence" /><br>
      <sub><b>Peer presence</b> — per-author colors, tool, selection</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/screenshots/CoopEditor4.png" alt="Shared project sync" width="720" /><br>
      <sub><b>Shared project sync</b> — joiners auto-download the host's project &amp; relaunch into it</sub>
    </td>
  </tr>
</table>

### Vehicles &amp; Maps

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/cars-overview.jpg" alt="Vehicle browser" /><br>
      <sub><b>Vehicle browser</b> — every car, stock &amp; modded</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/cars-editor.jpg" alt="Vehicle editor" /><br>
      <sub><b>Vehicle editor</b> — tweak configs in place</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/Maps.jpg" alt="Map browser" /><br>
      <sub><b>Map browser</b> — built-in &amp; modded levels</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/map-selection.jpg" alt="Map selection" /><br>
      <sub><b>Map selection</b> — spawn points and level metadata</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/LiveryEditor.jpg" alt="Livery editor" /><br>
      <sub><b>Livery editor</b> — per-config skin management</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/Controls-liveinput.jpg" alt="Controls editor" /><br>
      <sub><b>Controls editor</b> — live input viewer &amp; binder</sub>
    </td>
  </tr>
</table>

### Mods

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/Mods-installed.jpg" alt="Installed mods" /><br>
      <sub><b>Installed mods</b> — enable, disable, uninstall</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/Mods-browse.jpg" alt="Mod browser" /><br>
      <sub><b>Browse</b> — install from repo with one click</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/screenshots/mods-registry.jpg" alt="Mod registry" width="720" /><br>
      <sub><b>Registry</b> — deduplicated, indexed, searchable</sub>
    </td>
  </tr>
</table>

### Social &amp; Live

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/friends.jpg" alt="Friends" /><br>
      <sub><b>Friends</b> — online status &amp; server presence</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/voicechat.png" alt="Voice chat" /><br>
      <sub><b>Voice chat</b> — hybrid proximity + party audio</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/screenshots/Live-GPS.png" alt="Live GPS" width="720" /><br>
      <sub><b>Live GPS</b> — track players &amp; routes in real time</sub>
    </td>
  </tr>
</table>

### CareerMP

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/CareerMP-Saves.jpg" alt="CareerMP saves" /><br>
      <sub><b>Saves</b> — cloud-style slot manager</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/CareerMP-Mods.jpg" alt="CareerMP mods" /><br>
      <sub><b>Mods</b> — per-career mod sets</sub>
    </td>
  </tr>
</table>

### Settings &amp; Dev

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/settings1.png" alt="Settings — General" /><br>
      <sub><b>General</b></sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/settings2.png" alt="Settings — Appearance" /><br>
      <sub><b>Appearance</b></sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/settings3.png" alt="Settings — Visual" /><br>
      <sub><b>Visual filters</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="3">
      <img src="docs/screenshots/DevTools.png" alt="DevTools" width="720" /><br>
      <sub><b>DevTools</b> — Lua REPL, tabbed buffers, live output</sub>
    </td>
  </tr>
</table>

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
<summary>General configuration, appearance customization, and visual UI tweaks</summary>

**General**
- Auto-detect or manually set BeamNG.drive game paths (game directory, user folder, cache)
- Custom backend server URL with live health-check indicator; backend selection (official vs. custom) with auth URL configuration
- Configurable mod registry repositories — add multiple sources with name, URL, and priority; reorder via drag
- Default server ports and custom server executable path
- Graphics renderer selection — choose DirectX 11 or Vulkan (or prompt each launch)
- CareerMP save path override
- Modpack export (`.beampack` JSON bundle of selected mods) and import with conflict resolution

**Appearance**
- **Light / Dark / System theme toggle** — three-way selector with full dark and light palettes; System mode follows OS preference and auto-switches in real time
- Accent color picker with 12 preset colors (BeamMP Orange, Blue, Purple, Emerald, Rose, Cyan, Amber, Indigo, Pink, Teal, Lime, Sky) and custom hex input
- Background style selector: Default gradient, Solid, Subtle Accent, Vibrant — plus image mode with upload, blur intensity, and opacity
- Background image gallery with random rotation on launch
- UI scale slider (50%–200%) and font size slider (12–20px)
- Surface opacity and border opacity multipliers for glass-morphism effect
- Glassmorphism blur toggle
- Sidebar width slider (160–280px)
- Sidebar page reordering via drag with per-page visibility toggles

**Visual Customization**
- Corner Radius — slider from 0 (sharp edges) to 24px (very round)
- Button Size — Default, Comfortable, or Large touch targets
- Font Family — System, Monospace, or Serif
- Scrollbar Style — Default, Thin Accent, Rounded, or Hidden
- Animation Speed — Instant, Normal, or Relaxed
- Border Style — Normal, Borderless, Bold, or Accent
- Overlay Effect — None, Scanlines, Vignette, or Film Grain
- Visual Effects toggles — page fade-in, accent text selection, frosted glass panels, hover glow, hover lift
- Color Filters — brightness, contrast, and saturation sliders with one-click reset

</details>

### Coop World Editor

<details>
<summary>Edit BeamNG maps together in real time — no BeamMP server needed</summary>

Peer-to-peer collaborative World Editor that mirrors object placement, terrain edits, brush strokes, camera poses, and undo/redo history across every participant. Each player runs vanilla singleplayer BeamNG.drive; Content Manager bridges the in-game editor over a direct TCP relay so you see the other editor's cursor and changes in real time without a BeamMP server.

- **One-Click Host** — pick an advertise address (Tailscale, public IP, LAN, or loopback), optional token, auth mode, and level — then one button starts the relay AND launches BeamNG directly into the World Editor
- **One-Click Join** — paste a shareable `BEAMCM2:` session code; Content Manager decodes the host, port, token, session ID, and level; auto-forces you onto the host's level and launches into the editor
- **Session Code Format** — compact `BEAMCM2:<base64url>` blob encoding host, port, optional token, level, session ID, and display name — one string covers everything a peer needs
- **Host-Toggleable Auth** — choose per-session: **Open** (code-only), **Token** (code + shared secret), **Approval** (host accepts each joiner manually with Accept / Reject buttons), or **Friends only** (whitelisted BeamMP usernames)
- **Tailscale-Aware Addressing** — automatically surfaces your Tailnet IP alongside LAN and public IPs; tailnet entries are marked as recommended for zero-config cross-network play
- **Level Sync & Install Prompt** — the host's current level is advertised in the session code; joiners get a banner showing the required level and whether it's a built-in BeamNG map or a mod (with install hint when missing)
- **Shared Starting Project** — the host auto-provisions a coop project (`coop_<date>`) on session start, captures the current editor state into it, and exposes it to joiners as a downloadable snapshot so both sides start from an identical map state
- **Auto Project Download & Launch** — joiners pull the host's project zip over HTTP (sha256-verified), extract it into `levels/_beamcm_projects/<folder>/`, then Content Manager automatically relaunches BeamNG into the synced project — mirroring BeamMP's "download required mods before joining" flow
- **Mid-Session Project Push** — when the host swaps projects during a live session, a new offer is broadcast to every connected peer; joiners auto-download the new sha and relaunch into it without manual intervention
- **On-Disk Zip Cache** — the host's project zip is streamed to a dotfile next to the project folder (`.<folder>.coop.zip`) with on-the-fly sha256 hashing and served via `createReadStream`; cleaned up when the session stops
- **Load Project Picker** — pick any existing coop project from disk as the starting state when hosting, instead of relying on auto-provisioning
- **Live Op Stream** — every editor action (create/modify/delete object, brush stroke, field edit, terrain paint, undo, redo) is serialized and broadcast with author IDs, sequence numbers, and timestamps
- **Snapshot Replay** — new joiners receive a full snapshot of the current scene state on connect, then stream live ops going forward, so mid-session joining works cleanly
- **Peer Presence** — see other participants' editor camera positions, active tool, and selected object in real time with per-author color coding
- **Windows Firewall Helper** — one-click rule creation for the listen port **and** the project-zip HTTP port in a single UAC prompt (covers Tailscale's wintun interface that Electron's auto-prompt misses)
- **Discord Rich Presence** — shows "Editing Worlds with Friends" when you're on the coop editor page

</details>

### Lua Console

<details>
<summary>Live GE/VE-Lua REPL into the running BeamNG.drive process</summary>

- **Scope Selector** — switch between **GE-Lua** (game engine global state) and **VE-Lua** (per-vehicle, pick any spawned vehicle from the dropdown)
- **Multi-Line Editor** — full Lua editor with syntax highlighting, autocompletion, and snippet insertion; editor/output height splitter is resizable and persisted
- **Output Stream** — `print()`, `log()`, result returns, and errors are streamed back in real time with timestamps and per-entry typing (log / print / result / err)
- **Filter & Search** — filter output by entry type and free-text search across the stream
- **Command History** — every executed snippet is saved to a sidebar history list with replay; snippets tab offers a curated library of common one-liners
- **Inspector Tree** — right-side panel that recursively expands any Lua value (table, vector, object) returned from the game, with per-node actions
- **UI Files Panel** — browse and edit BeamNG UI Lua files directly in-app alongside the REPL (split or tabbed layout)
- **Connection Indicator** — shows whether the bridge is deployed, whether BeamNG.drive is running, and whether the REPL is live

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
- **Discord Rich Presence** — automatic Discord integration showing current activity (browsing page, server name, car, map, player count); smart server tag detection maps 30+ keywords to activity verbs (Drifting, Racing, Rallying, Rock Crawling, Demolition Derby, etc.); auto-reconnect with heartbeat; graceful fallback on Linux/Steam Deck
- **Voice Chat** — WebRTC peer-to-peer voice with two activation modes: Voice Activity Detection (adjustable sensitivity) and Push-to-Talk (configurable keybind); spatial/proximity audio with distance-based attenuation (10–200m range); door muffling when inside a vehicle; input device selection with hot-swap, gain control (0–300%), output volume, live mic test with RMS level meter; optional TURN server configuration for NAT traversal
- **Livery Editor** — fabric.js 2D canvas editor for painting vehicle skins onto UV templates; 8 tools (Select, Brush, Eraser, Shape, Text, Eyedropper, Fill, Pan); 4 shape types (Rectangle, Circle, Line, Triangle); full layer system with visibility, lock, and opacity; built-in decal library (30+ SVG decals across 6 categories); import external images; undo/redo history; save/load projects as JSON; export as a BeamNG skin mod with material properties (metallic, roughness, clearcoat); extensive keyboard shortcuts
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
- **Livery Editor** — core painting and export pipeline is functional; planned enhancements include multi-material zone support, template auto-loading improvements, and expanded decal library.

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
| Canvas | fabric.js |
| Editor | Monaco Editor |
| Animations | Framer Motion 12 |
| Voice | WebRTC (RTCPeerConnection) |
| i18n | react-i18next 17 / i18next 26 |

| Discord | discord-rpc |

---

```
src/
├── main/                # Electron main process
│   ├── ipc/             #   IPC handlers (~290 channels)
│   ├── services/        #   Backend services (~30 services)
│   └── utils/           #   Parsing utilities
├── preload/             # Context bridge
├── renderer/            # React frontend
│   └── src/
│       ├── components/  #   UI components
│       ├── hooks/       #   Custom React hooks
│       ├── locales/     #   23 language JSON files
│       ├── pages/       #   Page components (18 pages)
│       └── stores/      #   Zustand state stores (~10 stores)
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

#### 4. Trademark Usage — Referential Use

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
| *Feist v. Rural*, 499 U.S. 340 (1991) | [supreme.justia.com/cases/federal/us/499/340](https://supreme.justia.com/cases/federal/us/499/340/) |
| *Google v. Oracle*, 593 U.S. 1 (2021) | [supreme.justia.com/cases/federal/us/593/18-956](https://supreme.justia.com/cases/federal/us/593/18-956/) |

---

<div align="center">

**[BeamNG.drive](https://www.beamng.com/)** by BeamNG GmbH · **[BeamMP](https://beammp.com/)** multiplayer mod · Built with **[electron-vite](https://electron-vite.org/)**

</div>
