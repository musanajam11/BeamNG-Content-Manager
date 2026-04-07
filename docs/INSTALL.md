# Installation Guide

How to install **BeamNG Content Manager** on your system.

---

## Download

Go to the [**Releases**](https://github.com/musanajam11/BeamNG-Content-Manager/releases) page and download the latest version for your platform:

| Platform | File | Size |
|:---------|:-----|:-----|
| **Windows** | `beamng-content-manager-*-setup.exe` | ~120 MB |
| **Linux (portable)** | `beamng-content-manager-*.AppImage` | ~120 MB |
| **Linux (Debian/Ubuntu)** | `beamng-content-manager-*.deb` | ~85 MB |
| **macOS** | `beamng-content-manager-*.dmg` | ~120 MB |

---

## Windows

1. Download `beamng-content-manager-*-setup.exe` from [Releases](https://github.com/musanajam11/BeamNG-Content-Manager/releases)
2. Run the installer — it may show a SmartScreen warning since the app is not code-signed:
   - Click **"More info"** → **"Run anyway"**
3. The installer creates:
   - A desktop shortcut
   - A Start Menu entry
4. Launch **BeamMP Content Manager** from the desktop or Start Menu
5. On first launch, the **Setup Wizard** guides you through:
   - Game path detection (auto-detected or manual)
   - Backend configuration

### System Tray

When you close the window, the app **minimizes to the system tray** (like Discord). To fully quit:
- Right-click the tray icon → **Quit**

---

## Linux

### AppImage (Recommended)

```bash
# Download the AppImage
chmod +x beamng-content-manager-*.AppImage
./beamng-content-manager-*.AppImage
```

> [!TIP]
> For desktop integration (launcher icon, file associations), use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher).

### Debian / Ubuntu (.deb)

```bash
sudo dpkg -i beamng-content-manager-*.deb
```

Then launch from your application menu or run:

```bash
beamng-content-manager
```

### Proton / Steam Play

The app auto-detects BeamNG.drive installed via Steam with Proton. It finds the Proton prefix and launches the game through `steam -applaunch 284160`.

---

## macOS

1. Download `beamng-content-manager-*.dmg` from [Releases](https://github.com/musanajam11/BeamNG-Content-Manager/releases)
2. Open the DMG and drag **BeamMP Content Manager** to your Applications folder
3. On first launch, macOS may block the app:
   - Go to **System Settings → Privacy & Security** and click **"Open Anyway"**

> [!NOTE]
> BeamNG.drive on macOS has limited support. The app is fully functional, but game integration depends on your BeamNG setup.

---

## First Launch

On first launch, you'll see the **Setup Wizard**:

1. **Welcome** — overview of the app
2. **Game Paths** — auto-detects BeamNG.drive installation, or let you browse manually
3. **Backend** — configure the backend server URL (with health-check validation)
4. **Done** — you're ready to go

After setup, the app opens to the **Dashboard** showing your favorite servers, recent mods, and game status.

---

## Updating

When a new version is available:
- **Windows**: Download the new installer and run it — it upgrades in place
- **Linux AppImage**: Download the new AppImage and replace the old one
- **Linux deb**: Install the new `.deb` — it upgrades the existing installation
- **macOS**: Download the new DMG and replace the app in `/Applications`

GitHub Releases will show changelogs for each version.

---

## Uninstalling

### Windows
- Open **Settings → Apps → Installed apps**
- Find **BeamMP Content Manager** and click **Uninstall**

### Linux (deb)
```bash
sudo apt remove beamng-content-manager
```

### Linux (AppImage)
Simply delete the `.AppImage` file.

### macOS
Drag the app from `/Applications` to the Trash.
