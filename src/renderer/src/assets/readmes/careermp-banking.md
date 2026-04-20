# CareerMP Banking 🏦

A custom BeamNG UI app for CareerMP that provides a cleaner banking interface for player payments.

CareerMP Banking uses CareerMP's payment backend. The Banking app handles the custom UI and incoming-payment opt-out toggle, while money movement, transaction limits, and balance changes still go through CareerMP itself.

## Features

- Custom `CareerMP Banking` UI app for Career mode.
- Live balance display pulled from the player's Career money.
- Online player list with direct send actions.
- Preset transfer amounts for faster payments.
- `Incoming enabled` / `Incoming disabled` toggle for players who do not want to receive payments.
- Uses CareerMP's `careerMPPlayerPayments` client module.
- Uses CareerMP's `payPlayer` server event.
- Keeps server-side payment limits controlled by CareerMP.
- Movable and resizable app window with saved placement support.

## Installation

1. Install CareerMP as normal! (v0.0.26 MINIMUM)
2. Download the latest CareerMP Banking Release and extract in your main server directory!
Should look like this:
   - `Resources/Client/CareerMPBanking.zip`
   - `Resources/Server/CareerMPBanking/careerMPBanking.lua`
   - `Resources/Server/CareerMP/zz_CareerMPBankingAppBridge.lua`
3. Start BeamMP with CareerMP and CareerMP Banking installed.
4. The banking app should be added to supported UI layouts automatically.
5. If needed, open the BeamNG UI Apps menu and enable `CareerMP Banking`.

## What The App Does

Players can use the app to:

- view their current balance
- see other online players
- send money directly to another player
- use preset payment amounts
- disable or enable incoming payments

## CareerMP Payment Settings

Payment limits are controlled by CareerMP in:

`Resources/Server/CareerMP/config/config.json`

CareerMP's default server payment values are defined in:

`Resources/Server/CareerMP/careerMP.lua`

Relevant values:

- `allowTransactions`
  Enables or disables player payments on the server.
- `sessionSendingMax`
  Maximum total amount a player can send in one session.
- `sessionReceiveMax`
  Maximum total amount a player can receive in one session.
- `shortWindowMax`
  Maximum amount allowed inside the short time window.
- `shortWindowSeconds`
  Length of the short time window in seconds.
- `longWindowMax`
  Maximum amount allowed inside the long time window.
- `longWindowSeconds`
  Length of the long time window in seconds.

## Incoming Payment Toggle

The `Incoming enabled` / `Incoming disabled` pill in the Banking UI saves each player's preference locally and sends it to the server.

The server patch at:

`Resources/Server/CareerMP/zz_CareerMPBankingAppBridge.lua`

loads inside CareerMP's server plugin and wraps CareerMP's `payPlayer` function. If the receiving player has disabled incoming payments, the payment is blocked before CareerMP processes it and the sender gets a returned-payment message.

Keep this file inside the existing `Resources/Server/CareerMP/` folder. It is named with `zz_` so it loads after CareerMP's main server file.


## Notes

- The old Banking-specific payment backend is disabled in this update.
- The incoming payment toggle is kept as a small CareerMP-side opt-out patch.
- The app starts closed by default and can be opened from its `B` tab.
