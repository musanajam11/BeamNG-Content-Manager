# Player Dealership + Loaner System for CareerMP

A modular multiplayer career expansion for CareerMP, with a player-run vehicle marketplace, timed temporary keys, and optional party tools.

Standalone server-side and client-side add-on for CareerMP servers in BeamNG.drive. Designed to work as a modular layer on top of CareerMP — especially for servers using RLS + CareerMP — while staying isolated from the main compatibility patch.

## What The Mod Does

### Dealership / Marketplace

- Lets players list vehicles from their own inventory.
- Creates a server-wide marketplace for other players to browse.
- Handles buyer/seller handshake flow for player-to-player vehicle sales.
- Removes listings when they are delisted, sold, or invalidated.
- Prevents conflicting states such as listing a vehicle that is already temporarily loaned out.

### Temporary Keys / Loaners

- Lets a player lend one of their vehicles to another online player for a limited time.
- Supports manual `Revoke` by the owner.
- Supports manual `Return` by the borrower.
- Automatically expires the temporary key when the timer runs out.
- Reconciles borrowed vehicles on rejoin so temporary loan access survives reconnects cleanly.
- Removes temporary access automatically if the vehicle is sold.

### Party Tools

- Create a party, invite players, accept invites.
- Leave or disband the party.
- View party members and their online state.
- Share vehicles with the party in a separate party-only visibility layer.

### UI App

The mod ships with a dedicated in-game UI app:

- `Party` tab for members, invites, and party-shared vehicles.
- `Dealership` tab for inventory management, listings, and marketplace browsing.
- `Loaners` tab for timed temporary key grants and borrowed vehicle tracking.

### Optional RLS Phone Integration

RLS uses its own Vue phone bundle instead of the standard BeamNG UI app layout system, so the phone integration is generated locally from your own RLS compatible zip instead of committing redistributed RLS files to this repository.

The generated phone build adds a native `Player Dealer` app inside the RLS phone. It renders marketplace listings, owned vehicles, and your active dealership listings directly inside the phone UI.

Build a patched RLS compatible zip from your local RLS compatible zip:

```powershell
python .\scripts\build_rls_phone_overlay.py --rls-compatible-zip "C:\Path\To\rls_career_overhaul_2.6.5.1_careermp_compatible.zip" --full-rls-out ".\dist\rls_career_overhaul_2.6.5.1_careermp_compatible_phone.zip"
```

If `python` does not work on your system, use `py` instead. Install the generated patched RLS zip on the BeamMP server in place of the unpatched RLS compatible zip:

```text
Resources/Client/rls_career_overhaul_2.6.5.1_careermp_compatible.zip
```

## Install

The release zip is a ready-to-use package. Extract it into the root of your BeamMP server directory (the folder containing `BeamMP-Server.exe`):

```text
Resources/Client/CareerMPPartySharedVehicles.zip   ← client BeamNG mod
Resources/Server/CareerMPPartySharedVehicles/       ← server Lua plugin
```

Both components are required. The client zip is downloaded automatically by BeamMP when players connect.

## Notes

- This project is intentionally kept separate from the main `RLS + CareerMP` compatibility patch.
- Dealership and loaner features are the primary focus; party tools are a supporting social layer.
- For the optional RLS phone integration, you must build the phone overlay locally from your own RLS compatible zip — redistributed RLS files are not included in this repository.

## Current Scope (Beta)

- Player dealership listings and marketplace browsing.
- Timed loaner access with revoke/return controls.
- Party state, invites, and party-only shared vehicle registry.
- Server-side JSON persistence.

## Credits

- In-game UI visual direction inspired by the `Banking UI App` mod by `@deadendreece`.
- Builds its own dealership, loaner, and party workflow on top of CareerMP.
