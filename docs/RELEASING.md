# Creating a Release

How to publish a new version of BeamNG Content Manager.

---

## Quick Release (Recommended)

1. **Bump the version** in `package.json`:
   ```bash
   npm version patch   # 0.1.0 → 0.1.1
   # or
   npm version minor   # 0.1.0 → 0.2.0
   # or
   npm version major   # 0.1.0 → 1.0.0
   ```

2. **Push the tag** to trigger the CI build:
   ```bash
   git push origin main --tags
   ```

3. The **GitHub Actions** workflow automatically:
   - Builds Windows (`.exe`), Linux (`.AppImage`, `.deb`), and macOS (`.dmg`) installers
   - Creates a **draft release** with all artifacts attached
   - Generates release notes from commit history

4. Go to [Releases](https://github.com/musanajam11/BeamNG-Content-Manager/releases), review the draft, edit the description if needed, and click **Publish**.

---

## Manual Release

If you need to build locally instead of using CI:

### Windows
```bash
npm run build:win
```
Produces: `dist/beamng-content-manager-{version}-setup.exe`

### Linux
```bash
npm run build:linux
```
Produces:
- `dist/beamng-content-manager-{version}.AppImage`
- `dist/beamng-content-manager-{version}.deb`

### macOS
```bash
npm run build:mac
```
Produces: `dist/beamng-content-manager-{version}.dmg`

Then upload these files to a new GitHub Release manually.

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

| Bump | When |
|:-----|:-----|
| `patch` (0.1.**1**) | Bug fixes, minor tweaks |
| `minor` (0.**2**.0) | New features, non-breaking changes |
| `major` (**1**.0.0) | Breaking changes, major milestones |

---

## Release Checklist

- [ ] All TypeScript errors resolved (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Version bumped in `package.json`
- [ ] Tested locally in dev mode (`npm run dev`)
- [ ] Git tag created and pushed
- [ ] CI build passes on all platforms
- [ ] Release notes reviewed and published
