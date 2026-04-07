# Building from Source

Step-by-step guide to build **BeamNG Content Manager** from source on Windows, Linux, or macOS.

---

## Prerequisites

| Requirement | Version | Check |
|:------------|:--------|:------|
| [Node.js](https://nodejs.org/) | 22+ | `node --version` |
| [Git](https://git-scm.com/) | any | `git --version` |
| npm | 10+ (ships with Node) | `npm --version` |

> [!NOTE]
> [BeamNG.drive](https://www.beamng.com/) should be installed for the app to function at runtime, but is **not** required to build.

---

## 1. Clone the Repository

```bash
git clone https://github.com/musanajam11/BeamNG-Content-Manager.git
cd BeamNG-Content-Manager
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Development Mode

Run the app in development mode with hot-reload:

```bash
npm run dev
```

This starts electron-vite in dev mode — changes to the renderer (React) are hot-reloaded instantly, and changes to main/preload trigger a restart.

## 4. Type Checking

Verify TypeScript types before building:

```bash
npm run typecheck
```

## 5. Linting

```bash
npm run lint
```

## 6. Build for Production

Build a distributable installer for your platform:

```bash
# Windows — produces NSIS installer (.exe)
npm run build:win

# Linux — produces AppImage + .deb
npm run build:linux

# macOS — produces .dmg
npm run build:mac
```

Build artifacts are output to the `dist/` directory.

### Windows Build Notes

> [!IMPORTANT]
> On Windows, **Developer Mode** must be enabled for the build to succeed.
> Go to **Settings → Privacy & Security → For Developers** and toggle it on.
>
> This is required because electron-builder's code signing cache contains macOS symlinks that need elevated privileges to extract.

### Linux Build Notes

Building on Linux requires no special configuration. The build produces both an AppImage (portable) and a `.deb` package.

### macOS Build Notes

Code signing and notarization are disabled by default. For distribution, configure `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables with your Apple Developer certificate.

---

## Available Scripts

| Script | Description |
|:-------|:------------|
| `npm run dev` | Start in development mode with hot-reload |
| `npm run build` | Typecheck + production build (no packaging) |
| `npm run build:win` | Build + package Windows installer |
| `npm run build:linux` | Build + package Linux AppImage & deb |
| `npm run build:mac` | Build + package macOS DMG |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm start` | Preview the production build |

---

## Project Structure

```
src/
├── main/                # Electron main process
│   ├── ipc/             #   IPC handlers
│   ├── services/        #   Backend services (15 services)
│   └── utils/           #   Parsing utilities
├── preload/             # Context bridge (API exposed to renderer)
├── renderer/            # React frontend
│   └── src/
│       ├── components/  #   UI components
│       ├── hooks/       #   Custom React hooks
│       ├── pages/       #   Page components (10 pages)
│       └── stores/      #   Zustand state stores
└── shared/              # Types shared between main & renderer
```

---

## Troubleshooting

<details>
<summary><b>Build fails with "Cannot create symbolic link"</b></summary>

**Windows only.** Enable Developer Mode in Windows Settings → For Developers. This grants the symlink creation privilege needed by electron-builder's code signing cache.

</details>

<details>
<summary><b>TypeScript errors during build</b></summary>

Run `npm run typecheck` separately to see all errors with file locations. Fix them before running the build command.

</details>

<details>
<summary><b>electron-vite dev shows a blank window</b></summary>

Check the DevTools console (Ctrl+Shift+I) for errors. Common causes:
- Missing environment variables
- Game path not configured (expected on first run — the setup wizard handles this)

</details>

<details>
<summary><b>Linux: AppImage won't launch</b></summary>

Make it executable first:
```bash
chmod +x beamng-content-manager-*.AppImage
./beamng-content-manager-*.AppImage
```

</details>
