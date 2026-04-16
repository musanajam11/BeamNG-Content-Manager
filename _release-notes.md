## 🎙️ Proximity Voice Chat — *Full System*

Talk to nearby players in real-time with a fully integrated voice chat system:

- **Push-to-Talk (PTT) or Voice Activity Detection (VAD)** — choose your activation mode with configurable PTT key binding and VAD sensitivity threshold
- **Spatial Audio with Proximity Fade** — voices fade naturally over distance (configurable 0–100m range, default 50m)
- **Door Muffling** — audio is automatically muffled when you're inside a vehicle with the doors closed, adding immersion
- **Full Audio Controls** — input device selection, input gain (0–300%), output volume (0–100%)
- **NAT Traversal** — optional TURN server configuration (URL, username, credential) for players behind restrictive NATs
- **Auto-Deployed Lua Bridge** — CM automatically deploys the voice chat Lua plugin to your game and server; no manual file copying
- **Live Peer Panel** — see who's connected and who's currently speaking in real-time
- **File-Based Signal Transport** — reliable JSON signaling between CM and BeamNG via polling (100ms)

---

## 🎨 Livery Editor — *Full Canvas Implementation*

The livery editor has graduated from "Coming Soon" to a fully functional 2D painting system:

- **Fabric.js Canvas** — draw directly on vehicle UV templates
- **Vehicle Selection** — browse and select any vehicle; UV coordinates auto-load
- **Layer System** — add, remove, lock, show/hide, reorder layers with per-layer opacity
- **10 Drawing Tools** — Select, Draw (freehand), Eraser, Shapes (rect/circle/line/triangle), Text, Eyedropper, Fill, Pan
- **Color Controls** — fill color, stroke color, stroke width, and opacity per tool
- **Image Import** — drag-and-drop or file browser for image layers
- **Decal Library** — built-in SVG decal collection with quick-add
- **Project Persistence** — save and load projects as JSON with full canvas state
- **Undo / Redo** — full history stack (up to 50 states)

---

## 📊 Career Save Manager — *Rich Metadata & Server Tracking*

Career save profiles now surface deep gameplay data at a glance:

- **Vehicle Cards** — thumbnail preview, value ($), horsepower, torque, weight, odometer, insurance class, license plate
- **Player Stats** — BeamXP level, cash, missions completed, businesses discovered, locations found, branch unlocks, logbook entries
- **RLS Integration** — bank balance and credit score for RLS profiles
- **Slot Preview Strips** — see key stats and vehicle thumbnails per autosave slot without opening it
- **Server Association** — each profile now shows which BeamMP server you last made progress on (only recorded when saves actually update during a session, not just from connecting)

---

## 🗺️ Server Manager — *Player Heatmap & Voice Plugin Deployment*

- **Live Player Heatmap** — real-time position tracking with 256×256 accumulation grid and 3D heat overlay
- **Player Sidebar** — connected players with color-coded dots, vehicle names, engine status
- **Tracker Plugin** — one-click deploy/undeploy of tracker.lua to your server with status pulse indicator
- **Voice Plugin Deployment** — deploy/undeploy the voice chat server plugin separately from the tracker

---

## 🎮 Discord Rich Presence — *Enhanced States*

- Now shows **current vehicle name** while playing on a server (polled from live GPS telemetry)
- **Server tag parsing** — activity verb adapts to server tags (e.g., "Drifting in...", "Playing CareerMP in...")
- Shows **player count** (current/max) when connected
- **Cleaned map names** — human-readable map display (e.g., "Grid Map" instead of "gridmap_v2")
- Page labels for all new features: Voice Chat, Livery Editor

---

## 🖥️ Server Browser Improvements

- **Map preview hero images** in server detail panel
- **Population fill bar** — color-coded (green/amber/rose) based on capacity
- **Server badges** — Official, Modded, Password, High Pop, Empty, Offline indicators
- **Content tags** — parsed and displayed as visual badges
- **Queue system** — start queue, cancel, elapsed time display
- **Marquee scrolling** for long server names

---

## 🧭 Setup Wizard & QoL

- **Auto-detection** of BeamNG paths with UI feedback
- **Backend health check** validation during setup
- **Rotating motivational tips** during setup (8 tips, 5s rotation with fade)
- **Sidebar** — Voice Chat now appears in the default navigation order
- **Discord `discordSetPage`** type declaration fix (was missing, caused silent failures)
- **Typecheck cleanup** — reduced pre-existing type errors from 22 → 7

---

**Full Changelog**: https://github.com/musanajam11/BeamNG-Content-Manager/compare/v0.3.4...v0.3.5
