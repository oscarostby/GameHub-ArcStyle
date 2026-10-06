# GameHub ArcStyle

A console-style launcher app for Linux (Arch and Ubuntu), similar to Steam Big Picture but for *everything* on your PC. It puts your Steam, Epic, GOG, Lutris and desktop games, plus every other program (browsers, chat, media, the game stores), in one full-screen hub that you can drive with a controller, a keyboard or a mouse.

GameHub runs as its own desktop app: a native GTK 4 window with the interface rendered by WebKitGTK (the same idea as Big Picture, which draws its UI with web tech internally). Controllers are read natively through libmanette, so no browser is involved.

The home screen puts your games on a curved **arc rail**. The selected game's artwork fills the background. Its logo, stats and a big **Play** button sit underneath, similar to the home screen on a modern console.

## Features

- **Finds your games automatically**
  - **Steam**: every library folder, with artwork from the local cache or the Steam CDN.
  - **Heroic**: Epic and GOG games, with their store artwork.
  - **Lutris**: installed games, with cover art and banners.
  - **Desktop games**: any `.desktop` entry in the *Game* category, including Flatpaks.
  - **Custom games**: add anything that starts with a command, such as emulators, AppImages, scripts or itch.io games.
- **Apps tab**: every other program in your app menu, with its icon, grouped into Internet, Media, Graphics, Office, Development, Utilities and System.
- **Steps aside while you play**: GameHub hides when a game or app starts and comes back by itself when it closes. You can turn this off in Settings.
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
  - Turn each store scanner and the Apps tab on or off, and show or hide hidden games.
  - Step aside while playing.
- **Top bar status**: clock, network, battery (on laptops and handhelds) and controller indicator.
- **Synthesized UI sounds**, so no audio files are needed.
- **Native desktop app**: full screen over everything, **Super+O** (Windows key + O) to open and close it, an app-menu entry and icon, F11 to toggle full screen and Ctrl+Q to quit. Only one copy ever runs. Packages are provided for Arch (PKGBUILD) and Ubuntu (.deb).

## Install

### Quick install (Arch, CachyOS, Manjaro, Ubuntu 24.04+, Fedora)

```bash
git clone https://github.com/oscarostby/GameHub-ArcStyle.git
cd GameHub-ArcStyle
./install.sh               # installs dependencies (asks for sudo) + app menu entry
./install.sh --autostart   # same, and start GameHub on login (couch/TV PC)
./install.sh --uninstall
```

Then press **Super+O** (Windows key + O), open **GameHub ArcStyle** from your app menu, or run `gamehub-arcstyle`. It opens full screen over everything. Press Super+O again to close it; it keeps running in the background, so it comes back instantly next time. Ctrl+Q quits it completely.

### As a system package

**Arch / CachyOS:**

```bash
cd packaging/arch && makepkg -si
```

**Ubuntu 24.04+ / Debian 13+:**

```bash
packaging/debian/build-deb.sh
sudo apt install ./gamehub-arcstyle_*_all.deb
```

### Dependencies

| | Arch | Ubuntu |
| --- | --- | --- |
| GTK 4 + PyGObject | `gtk4 python-gobject` | `gir1.2-gtk-4.0 python3-gi` |
| WebKitGTK 6.0 | `webkitgtk-6.0` | `gir1.2-webkit-6.0` |
| Controllers | `libmanette` | `gir1.2-manette-0.2` |

### Command line options

| Option | What it does |
| --- | --- |
| `--windowed` | Start in a window instead of full screen (F11 toggles) |
| `--demo` | Show a demo library (launching is simulated). Good for trying out the UI |
| `--browser` | Fallback: show the UI in a browser window instead of the native app |
| `--debug` | Enable the WebKit inspector (right click → Inspect) |
| `--port N` | Internal port (default 47800, or a free one if it's busy) |

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

GameHub's window talks to a small built-in server that only listens on `127.0.0.1`. Every API request has to carry a random token that is created each time GameHub starts and is only placed in the page it serves. Requests with a foreign `Host` header are rejected. This stops other websites open in your browser from launching anything.

## Troubleshooting

- **The controller does nothing:** make sure `libmanette` (Arch) or `gir1.2-manette-0.2` (Ubuntu) is installed, and that the GameHub window has focus. Controller input is ignored while a game is in front.
- **Missing artwork:** Steam art comes from the local cache first and falls back to the Steam CDN, so you need to be online for it. Games without art get a generated cover.
- **A game isn't found:** open Settings and make sure that store's scanner is on, then choose *Rescan library*. You can always add it with *Add game*.

## Development

```bash
python3 -m unittest discover -s tests -t .   # backend tests
./gamehub.py --demo --windowed --debug       # UI with demo data and inspector
```

Project layout:

```
gamehub/        Python backend (scanners, launcher/process tracking, HTTP API, storage)
  native.py     GTK 4 window, WebKit view and libmanette controller input
packaging/      Arch PKGBUILD, Debian/Ubuntu .deb builder, desktop entry and icon
web/            Front end (vanilla JS modules, no build step)
  js/input.js   gamepad + keyboard → actions (repeat, dead zones, controller detection)
  js/nav.js     spatial focus navigation
  js/osk.js     on-screen keyboard
  js/sound.js   WebAudio UI sounds
  js/app.js     views, overlays and app logic
```
