# GameHub ArcStyle

A console-style game launcher for Linux. All your games are in one full-screen hub, and you can drive it with a controller, a keyboard or a mouse.

The home screen puts your games on a curved **arc rail**. The selected game's artwork fills the background. Its logo, stats and a big **Play** button sit underneath, similar to the home screen on a modern console.

## Features

- **Finds your games automatically**
  - **Steam**: every library folder, with artwork from the local cache or the Steam CDN.
  - **Heroic**: Epic and GOG games, with their store artwork.
  - **Lutris**: installed games, with cover art and banners.
  - **Desktop games**: any `.desktop` entry in the *Game* category, including Flatpaks.
  - **Custom games**: add anything that starts with a command, such as emulators, AppImages, scripts or itch.io games.
- **Controller first**
  - Works with Xbox, PlayStation and Nintendo-style controllers.
  - Button hints switch automatically (A/B/X/Y, ✕/○/□/△, or keyboard keys).
  - Navigates with the analog stick and d-pad, with key repeat.
  - Rumble when a game launches.
  - Toasts when a controller connects or disconnects.
  - Input is ignored while a game has focus, so presses don't leak into the launcher.
- **On-screen keyboard** for search and forms, built for controllers. It has shortcuts for backspace, space, moving the cursor, shift and done.
- **Library view**
  - Grid of cover art.
  - Filters: All, Favorites, Recently played, one per store, and Hidden.
  - Sort by A–Z, recently played or most played.
  - Live search.
  - LT/RT jump a page at a time.
- **Game details**
  - Hero artwork and logo.
  - Play, favorite, hide/unhide, and remove (custom games).
  - Play time, last played, number of launches and size on disk.
  - LB/RB move to the previous/next game.
- **Play time tracking**
  - Steam games are tracked through their running processes. Custom and desktop games are tracked through the process GameHub starts.
  - A **Now playing** pill appears in the top bar, and a toast shows when a session ends.
- **Launch animation** with the game's art, a spinning glow ring and a sound.
- **Quick menu** (Start/☰): resume, toggle full screen, rescan, settings, quit, sleep, restart and shut down. Restart, shut down and quit ask you to confirm first.
- **Settings**
  - Accent color (the whole UI re-themes).
  - Background: game artwork, animated aurora, or solid.
  - 12/24-hour clock and profile name.
  - Interface sounds and volume, and controller vibration.
  - Turn each store scanner on or off, and show or hide hidden games.
- **Top bar status**: clock, network, battery (on laptops and handhelds) and controller indicator.
- **Synthesized UI sounds**, so no audio files are needed.
- **No dependencies**: only the Python 3.10+ standard library and a browser engine you already have.

## Getting started

```bash
git clone https://github.com/oscarostby/GameHub-ArcStyle.git
cd GameHub-ArcStyle
./gamehub.py
```

GameHub starts a small local server and opens itself full screen in its own window. It uses Chromium, Chrome, Brave, Vivaldi or Edge in `--app` kiosk mode, or Firefox in kiosk mode with a separate profile. Closing the window stops the launcher.

To add it to your app menu:

```bash
./install.sh              # menu entry
./install.sh --autostart  # also start on login (nice for a couch/TV PC)
./install.sh --uninstall
```

### Command line options

| Option | What it does |
| --- | --- |
| `--windowed` | Open in a normal window instead of full-screen kiosk mode |
| `--demo` | Show a demo library (launching is simulated). Good for trying out the UI |
| `--no-browser` | Only start the server, then open the printed URL yourself |
| `--port N` | Port to listen on (default 47800, or a free one if it's busy) |

## Controls

| Action | Xbox | PlayStation | Keyboard |
| --- | --- | --- | --- |
| Move | D-pad / left stick | D-pad / left stick | Arrow keys |
| Play / select | A | ✕ | Enter |
| Back | B | ○ | Esc / Backspace |
| Details | X | □ | X |
| Favorite | Y | △ | F |
| Switch tab | LB / RB | L1 / R1 | Q / E |
| Page up / down | LT / RT | L2 / R2 | PgUp / PgDn |
| Search | View | Share/Create | / |
| Quick menu | Menu / Guide | Options / PS | M |

You can also use the mouse: hover to select, click to activate, scroll the wheel over the rail, and click the button hints at the bottom.

## Where data lives

Settings, favorites, play time and custom games are stored in `~/.local/share/gamehub-arcstyle/state.json`. Delete that file to reset everything.

## Security

The server only listens on `127.0.0.1`. Every API request has to carry a random token that is created each time GameHub starts and is only placed in the page it serves. Requests with a foreign `Host` header are rejected. This stops other websites open in your browser from launching anything.

## Troubleshooting

- **The controller does nothing:** browsers only expose gamepads after the first button press, so press any button on the boot screen. In Firefox, the window must have focus.
- **Missing artwork:** Steam art comes from the local cache first and falls back to the Steam CDN, so you need to be online for it. Games without art get a generated cover.
- **A game isn't found:** open Settings and make sure that store's scanner is on, then choose *Rescan library*. You can always add it with *Add game*.

## Development

```bash
python3 -m unittest discover -s tests -t .   # backend tests
./gamehub.py --demo --windowed               # UI with demo data
```

Project layout:

```
gamehub/        Python backend (scanners, launcher/process tracking, HTTP API, storage)
web/            Front end (vanilla JS modules, no build step)
  js/input.js   gamepad + keyboard → actions (repeat, dead zones, controller detection)
  js/nav.js     spatial focus navigation
  js/osk.js     on-screen keyboard
  js/sound.js   WebAudio UI sounds
  js/app.js     views, overlays and app logic
```
