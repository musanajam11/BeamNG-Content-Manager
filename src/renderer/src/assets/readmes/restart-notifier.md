RestartNotifier V1.1 - A BeamMP plugin to notify players of multiple scheduled server restarts with timezone support, manual restart commands, and enhanced in-game configuration.
  By: DeadEndReece (UkDrifter) & Help with AI (People judge, but hey, if it does what you want thats all that matters right? - Reece 2026)

  Any issues or bugs can be reported in my discord (https://discord.com/invite/WDeb9fxuhq)

  How to set up:
  
  1. Place the "RestartNotifier" folder inside your server's "Resources/Server" directory, so the main.lua is located at "Resources/Server/RestartNotifier/main.lua". (time.txt will be auto-generated on first set with default settings)
 
  2. Ensure the server has write/read permissions to the "RestartNotifier" folder for saving settings.
 
  3. Set so you are a authorized user by using the console command: r.au or restart.adduser <yourname> (without brackets & with your actual BeamMP username as it appears in-game CASE SENSITIVE).

  4. Configure your desired restart times and timezone using the console commands (see commands section below).

  Features:
  
  • Multiple scheduled restarts (Max 4 limit) with timezone support and optional Daylight Saving Time adjustment.

  • Interactive-style numbered menus for clean, aligned in-game and console status/list displays.

  • Optimized CPU usage using non-blocking timers for the final server exit.
  
  • Customizable warning messages and intervals leading up to the restart.
  
  • Manual restart trigger with its own set of warnings and cancellation option.
  
  • Console commands for server admins to configure settings and manage authorized users.
  
  • Persistent configuration saved to a text file, allowing settings to survive server restarts.
  
  • Console echo option to also print warnings and status updates in the server console for admins to see. (Can be toggled on/off in the CONFIG table)
 
  • User management system to allow specific players to access in-game commands without giving them full console access.



  Commands:
  
  • restart.status (r.s)             - Current status & countdown (In-Game & Console)

  • restart.listtimes (r.lt)         - List all scheduled times (In-Game & Console)
  
  • restart.addtime (r.at) HH:MM     - Add a scheduled restart time (Max 4) (Console Only)

  • restart.removetime (r.rt) HH:MM  - Remove a scheduled restart time (Console Only)

  • restart.cleartimes (r.ct)        - Clear all scheduled times (Console Only)
 
  • restart.settimezone (r.sz) <name>- Set timezone (EST, GMT, CET or UTC offset) (Console Only)
 
  • restart.zones (r.z)              - List available timezones (Console Only)
 
  • restart.dst (r.dst) <on/off>     - Toggle Daylight Saving (+1 hr) (Console Only)
 
  • restart.firein (r.f) <mins>      - Start manual countdown (In-Game & Console)

  • restart.cancel (r.c)             - Cancel manual countdown (In-Game & Console)

  • restart.adduser (r.au) <name>    - Add auth player (Console Only)

  • restart.removeuser (r.ru) <name> - Remove auth player (Console Only)
 
  • restart.users (r.us)             - List auth players (Console Only)


  Notes: 
  
  • The plugin calculates the time until the next scheduled restart based on the server's current UTC time, the configured timezone offset, and DST setting. This ensures accurate scheduling regardless of where the server is hosted.
 
  • The plugin uses a single timer that ticks every second to check if it's time to send warnings or trigger the restart, which is more efficient than multiple timers for each warning.
 
  • This script does NOT handle the actual restart process. It only sends chat messages as warnings and then calls MP.Exit() to shut down the server safely when the time comes. You will need to have an external process or script that automatically restarts the server when it shuts down for this to work effectively. 

  Automatic Restart Setup:
  
  For windows I recommend https://github.com/StanleyDudek/BeamMP-Server-Watchdog for that purpose, which can be set to automatically restart the server whenever it detects it has stopped. 
  
  For linux, you can use a simple bash script with a loop that restarts the server whenever it exits, or use a process manager like systemd or pm2 to achieve the same effect.