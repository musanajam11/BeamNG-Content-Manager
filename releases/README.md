# Releases

## Download

Download pre-built installers from the [**GitHub Releases**](https://github.com/musanajam11/BeamNG-Content-Manager/releases) page.

| Platform | File | Size |
|:---------|:-----|:-----|
| **Windows** | `beamng-content-manager-*-setup.exe` | ~120 MB |
| **Linux** | `beamng-content-manager-*.AppImage` | ~120 MB |
| **Linux (deb)** | `beamng-content-manager-*.deb` | ~85 MB |
| **macOS** | `beamng-content-manager-*.dmg` | ~120 MB |

> [!NOTE]
> Installers are built automatically by CI on every tagged release. See [docs/RELEASING.md](../docs/RELEASING.md) for how releases are published.

---

## Windows Install

1. Download `beamng-content-manager-*-setup.exe`
2. Run the installer (click **"More info" → "Run anyway"** if SmartScreen warns)
3. Launch from the desktop shortcut or Start Menu

## Linux Install

**AppImage (portable):**
```bash
chmod +x beamng-content-manager-*.AppImage
./beamng-content-manager-*.AppImage
```

**Debian/Ubuntu:**
```bash
sudo dpkg -i beamng-content-manager-*.deb
```

## macOS Install

1. Download `beamng-content-manager-*.dmg`
2. Open the DMG and drag to Applications
3. **System Settings → Privacy & Security → Open Anyway** if blocked

---

## Build from Source

If you prefer to compile yourself:

```bash
git clone https://github.com/musanajam11/BeamNG-Content-Manager.git
cd BeamNG-Content-Manager
npm install
npm run build:win    # or build:linux / build:mac
```

Full instructions: [docs/BUILD.md](../docs/BUILD.md)
