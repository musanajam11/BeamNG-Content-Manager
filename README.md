# BeamNG Content Manager

A comprehensive desktop content manager for **BeamNG.drive** and **BeamMP** — manage mods, vehicles, maps, servers, and more from a single app.

Built with Electron, React, TypeScript, and Tailwind CSS. Cross-platform: Windows, Linux (including Proton), and macOS.

---

## Features

### Dashboard
- One-click singleplayer launch with game status indicator
- Favorite and recent servers with map preview cards
- Recently installed mods feed
- Aggregated news from Steam and BeamMP sources
- Registry update notifications

### Vehicle Browser
- Browse all installed vehicles with preview thumbnails
- Search and filter by type (car, truck, utility) or brand
- View detailed vehicle info: brand, body style, year, country, drivetrain, power, torque, weight
- Browse and manage all vehicle configurations (factory + custom)
- Create, clone, rename, and delete configs
- **Config Editor** — per-slot part selection with tuning variable sliders (min/max/units)
- **3D Vehicle Viewer** — interactive Three.js model with COLLADA loading, DDS textures, paint system, and live part updates *(in development)*

### Map Browser
- Browse installed maps with 16:9 preview images
- Search and filter by source (stock vs mod)
- View map metadata: terrain size, spawn points, world bounds, minimap
- Registry-sourced descriptions, tags, and external links

### Mod Manager
Three tabs for complete mod lifecycle management:

**Installed** — Table view of all mods with enable/disable toggles, delete with dependency checks, type-filtered search, disk usage stats, and full metadata panel with registry enrichment.

**Browse (beamng.com)** — OAuth login, search, category/sort filters, star ratings, download counts, one-click install with progress bar.

**Registry (CKAN-style)** — Pull from configurable mod repositories, verified badges, transitive dependency resolution, update notifications, and one-click updates.

### Server Browser
- Live server list with auto-refresh (30s polling)
- Search, sort (players/name/map/region), and quick filters (empty, full, official, modded, password)
- Favorite servers
- One-click join with mod sync overlay
- Queue system for full servers with auto-join
- Direct connect by IP:port
- BeamMP rich-text server name rendering

### Server Manager (Self-Hosted)
- Create, duplicate, start/stop/restart server instances
- Auto-download BeamMP Server binary (platform-aware)
- **Live Console** — real-time log output with command input
- **Config Editor** — server settings with BeamMP rich-text name editor (WYSIWYG)
- **File Manager** — browse and edit server files in-app (Monaco editor)
- **Mods Panel** — deploy/undeploy mods to servers
- **Scheduling** — automated backups, restarts, commands, chat messages (once/hourly/daily/weekly)
- **Analytics** — player session history with bar charts, player summaries, session drill-down
- **Player Heat Map** — 3D WebGL map with live player positions, density heat map overlay, and GPS route planner with road-following pathfinding *(in development)*

### Game Launcher
- Launch BeamNG.drive in singleplayer or multiplayer mode
- Built-in BeamMP protocol — no separate launcher needed
- BeamMP authentication with saved keys
- Color-coded launcher log viewer with filtering, copy, and export

### Settings
- Auto-detect or manually set game paths
- Custom backend server URL with health check
- Configurable mod registry repositories (name, URL, priority)
- Modpack export/import (`.beampack` JSON format)
- **Appearance** — accent color, UI scale, font size, background style/image, surface opacity, blur effects, sidebar width

### Additional
- First-run setup wizard (game paths, backend config)
- Tailscale integration for direct-connect networking
- Cross-platform: Windows (NSIS installer), Linux (AppImage, deb), macOS (DMG)
- Linux Proton/Steam support — auto-detects Proton installs, launches via Steam

---

## In Development

The following features are functional but actively being improved:

- **3D Vehicle Viewer & Editor** — COLLADA model rendering with DDS texture support and live config editing. Mesh classification, paint system, and wheel placement are working; further refinement ongoing.
- **Player Heat Map** — 3D map visualization with live tracking and GPS route planning. Core functionality works; polish and UX improvements in progress.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 22+
- [BeamNG.drive](https://www.beamng.com/) installed (auto-detected or manually configured)

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
# Windows (NSIS installer)
npm run build:win

# Linux (AppImage + deb)
npm run build:linux

# macOS (DMG)
npm run build:mac
```

Builds are output to `dist/`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
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
  main/              # Electron main process
    ipc/              #   IPC handlers
    services/         #   Backend services (15 services)
    utils/            #   Parsing utilities
  preload/            # Context bridge
  renderer/           # React frontend
    src/
      components/     #   UI components
      hooks/          #   Custom React hooks
      pages/          #   Page components (10 pages)
      stores/         #   Zustand state stores
  shared/             # Types shared between main & renderer
build/                # Electron-builder resources (icons)
resources/            # Bundled assets (backgrounds)
```

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

---

## Acknowledgments

- [BeamNG.drive](https://www.beamng.com/) by BeamNG GmbH
- [BeamMP](https://beammp.com/) multiplayer mod
- Built with [electron-vite](https://electron-vite.org/)
