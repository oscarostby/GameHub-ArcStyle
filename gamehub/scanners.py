"""Discover installed games from Steam, Heroic (Epic/GOG), Lutris and .desktop entries.

Every scanner returns a list of game dicts:
    {
        "id": "steam:570",
        "title": "Dota 2",
        "source": "steam",
        "launch": {"type": "uri" | "cmd" | "desktop" | "demo", ...},
        "art": {"cover": [...], "hero": [...], "logo": [...], "icon": [...]},
    }
Art entries are http(s) URLs or absolute local file paths, tried in order.
"""

import configparser
import json
import os
import re
import shlex
import sqlite3
from pathlib import Path

HOME = Path.home()

# ---------------------------------------------------------------------------
# Steam
# ---------------------------------------------------------------------------
STEAM_ROOTS = [
    HOME / ".steam/steam",
    HOME / ".local/share/Steam",
    HOME / ".var/app/com.valvesoftware.Steam/.local/share/Steam",
    HOME / "snap/steam/common/.local/share/Steam",
]

# Runtimes, Proton builds and redistributables that are not games.
STEAM_NON_GAMES = re.compile(
    r"^(Proton|Steam Linux Runtime|Steamworks Common|SteamVR|Steam Audio)|Redistributable|Dedicated Server",
    re.IGNORECASE,
)
STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/{name}"
STEAM_CDN_ALT = "https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/{name}"


def parse_vdf(text: str) -> dict:
    """Minimal parser for Valve's KeyValues text format."""
    tokens = re.findall(r'"((?:[^"\\]|\\.)*)"|([{}])', text)
    root: dict = {}
    stack = [root]
    key = None
    for quoted, brace in tokens:
        if brace == "{":
            child: dict = {}
            stack[-1][key if key is not None else ""] = child
            stack.append(child)
            key = None
        elif brace == "}":
            if len(stack) > 1:
                stack.pop()
            key = None
        elif key is None:
            key = quoted
        else:
            stack[-1][key] = quoted.replace('\\"', '"').replace("\\\\", "\\")
            key = None
    return root


def _steam_art(appid: str, root: Path) -> dict:
    cache = root / "appcache/librarycache"

    def local(name: str) -> list:
        found = []
        old = cache / f"{appid}_{name}"
        if old.is_file():
            found.append(str(old))
        new_dir = cache / appid
        if new_dir.is_dir():
            direct = new_dir / name
            if direct.is_file():
                found.append(str(direct))
            else:
                # Newer clients store some art under hashed sub-directories.
                found.extend(str(p) for p in sorted(new_dir.glob(f"*/{name}")))
        return found

    def remote(name: str) -> list:
        return [STEAM_CDN.format(appid=appid, name=name), STEAM_CDN_ALT.format(appid=appid, name=name)]

    return {
        "cover": local("library_600x900.jpg") + remote("library_600x900.jpg") + remote("header.jpg"),
        "hero": local("library_hero.jpg") + remote("library_hero.jpg") + remote("header.jpg"),
        "logo": local("logo.png") + remote("logo.png"),
        "icon": local("icon.jpg"),
    }


def scan_steam() -> list:
    games: dict[str, dict] = {}
    seen_roots = set()
    for root in STEAM_ROOTS:
        try:
            real = root.resolve()
        except OSError:
            continue
        if real in seen_roots or not (real / "steamapps").is_dir():
            continue
        seen_roots.add(real)

        libraries = {real}
        vdf = real / "steamapps/libraryfolders.vdf"
        if vdf.is_file():
            try:
                folders = parse_vdf(vdf.read_text(errors="ignore")).get("libraryfolders", {})
                for entry in folders.values():
                    path = entry.get("path") if isinstance(entry, dict) else entry
                    if isinstance(path, str) and path:
                        libraries.add(Path(path))
            except OSError:
                pass

        for library in libraries:
            for manifest in (library / "steamapps").glob("appmanifest_*.acf"):
                try:
                    state = parse_vdf(manifest.read_text(errors="ignore")).get("AppState", {})
                except OSError:
                    continue
                appid = state.get("appid")
                name = state.get("name") or ""
                if not appid or appid == "228980" or STEAM_NON_GAMES.search(name):
                    continue
                games[appid] = {
                    "id": f"steam:{appid}",
                    "title": name,
                    "source": "steam",
                    "launch": {"type": "uri", "uri": f"steam://rungameid/{appid}", "steamAppId": appid},
                    "art": _steam_art(appid, real),
                    "size": int(state.get("SizeOnDisk", 0) or 0),
                }
    return list(games.values())


# ---------------------------------------------------------------------------
# Heroic Games Launcher (Epic via Legendary, GOG)
# ---------------------------------------------------------------------------
HEROIC_ROOTS = [
    HOME / ".config/heroic",
    HOME / ".var/app/com.heroicgameslauncher.hgl/config/heroic",
]


def _read_json(path: Path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _heroic_library_art(root: Path) -> dict:
    """Map appName -> art dict from Heroic's store caches."""
    art = {}
    for cache_name in ("legendary_library.json", "gog_library.json", "nile_library.json"):
        data = _read_json(root / "store_cache" / cache_name)
        if not data:
            continue
        items = data.get("library") or data.get("games") or []
        for item in items:
            if not isinstance(item, dict) or not item.get("app_name"):
                continue
            art[item["app_name"]] = {
                "title": item.get("title"),
                "cover": [u for u in (item.get("art_square"), item.get("art_cover")) if u],
                "hero": [u for u in (item.get("art_background"), item.get("art_cover")) if u],
                "logo": [u for u in (item.get("art_logo"),) if u],
            }
    return art


def scan_heroic() -> list:
    games = []
    for root in HEROIC_ROOTS:
        if not root.is_dir():
            continue
        art = _heroic_library_art(root)

        epic = _read_json(root / "legendaryConfig/legendary/installed.json") or {}
        for app_name, info in epic.items():
            if not isinstance(info, dict) or info.get("is_dlc"):
                continue
            meta = art.get(app_name, {})
            games.append(_heroic_game("legendary", app_name, info.get("title") or meta.get("title") or app_name, meta))

        gog = _read_json(root / "gog_store/installed.json") or {}
        for info in gog.get("installed", []):
            app_name = str(info.get("appName", ""))
            if not app_name or info.get("is_dlc"):
                continue
            meta = art.get(app_name, {})
            games.append(_heroic_game("gog", app_name, meta.get("title") or info.get("title") or app_name, meta))
    return games


def _heroic_game(runner: str, app_name: str, title: str, meta: dict) -> dict:
    return {
        "id": f"heroic:{runner}:{app_name}",
        "title": title,
        "source": "heroic",
        "launch": {"type": "uri", "uri": f"heroic://launch?appName={app_name}&runner={runner}"},
        "art": {
            "cover": meta.get("cover", []),
            "hero": meta.get("hero", []),
            "logo": meta.get("logo", []),
            "icon": [],
        },
    }


# ---------------------------------------------------------------------------
# Lutris
# ---------------------------------------------------------------------------
LUTRIS_ROOTS = [
    HOME / ".local/share/lutris",
    HOME / ".var/app/net.lutris.Lutris/data/lutris",
]
LUTRIS_CACHE_ROOTS = [
    HOME / ".cache/lutris",
    HOME / ".var/app/net.lutris.Lutris/cache/lutris",
]


def scan_lutris() -> list:
    games = []
    for root in LUTRIS_ROOTS:
        db = root / "pga.db"
        if not db.is_file():
            continue
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            rows = con.execute(
                "SELECT id, name, slug, runner FROM games WHERE installed = 1 ORDER BY name"
            ).fetchall()
            con.close()
        except sqlite3.Error:
            continue
        for game_id, name, slug, runner in rows:
            if runner == "steam":
                continue  # already covered by the Steam scanner
            art_dirs = [root] + LUTRIS_CACHE_ROOTS
            covers = [str(d / "coverart" / f"{slug}.jpg") for d in art_dirs if (d / "coverart" / f"{slug}.jpg").is_file()]
            banners = [str(d / "banners" / f"{slug}.jpg") for d in art_dirs if (d / "banners" / f"{slug}.jpg").is_file()]
            games.append({
                "id": f"lutris:{game_id}",
                "title": name,
                "source": "lutris",
                "launch": {"type": "uri", "uri": f"lutris:rungameid/{game_id}"},
                "art": {"cover": covers + banners, "hero": banners + covers, "logo": [], "icon": []},
            })
    return games


# ---------------------------------------------------------------------------
# .desktop entries in the "Game" category
# ---------------------------------------------------------------------------
def _xdg_app_dirs() -> list:
    data_home = Path(os.environ.get("XDG_DATA_HOME") or HOME / ".local/share")
    data_dirs = os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share"
    dirs = [data_home / "applications"] + [Path(d) / "applications" for d in data_dirs.split(":") if d]
    dirs += [Path("/var/lib/flatpak/exports/share/applications"), HOME / ".local/share/flatpak/exports/share/applications"]
    unique = []
    for d in dirs:
        if d not in unique:
            unique.append(d)
    return unique


ICON_SIZES = ["512x512", "256x256", "scalable", "192x192", "128x128", "96x96", "64x64", "48x48"]


def resolve_icon(name: str) -> list:
    if not name:
        return []
    if name.startswith("/"):
        return [name] if Path(name).is_file() else []
    bases = [HOME / ".local/share/icons", Path("/usr/share/icons"), Path("/var/lib/flatpak/exports/share/icons"),
             HOME / ".local/share/flatpak/exports/share/icons"]
    found = []
    for base in bases:
        for size in ICON_SIZES:
            for ext in ("png", "svg"):
                candidate = base / "hicolor" / size / "apps" / f"{name}.{ext}"
                if candidate.is_file():
                    found.append(str(candidate))
        if found:
            break
    for ext in ("png", "svg", "xpm"):
        pixmap = Path("/usr/share/pixmaps") / f"{name}.{ext}"
        if pixmap.is_file():
            found.append(str(pixmap))
    return found[:2]


LAUNCHER_APPS = re.compile(r"steam|lutris|heroic|gamehub|bottles|itch|minigalaxy", re.IGNORECASE)


def scan_desktop() -> list:
    games = {}
    for directory in _xdg_app_dirs():
        if not directory.is_dir():
            continue
        for path in directory.glob("*.desktop"):
            if path.name in games:
                continue
            parser = configparser.ConfigParser(interpolation=None, strict=False)
            parser.optionxform = str
            try:
                parser.read(path, encoding="utf-8")
            except (configparser.Error, UnicodeDecodeError, OSError):
                continue
            if "Desktop Entry" not in parser:
                continue
            entry = parser["Desktop Entry"]
            categories = entry.get("Categories", "").split(";")
            if "Game" not in categories or entry.get("Type", "Application") != "Application":
                continue
            if entry.get("NoDisplay", "false").lower() == "true" or entry.get("Hidden", "false").lower() == "true":
                continue
            exec_line = entry.get("Exec", "")
            # Games owned by Steam/Lutris/Heroic are picked up by their own scanners.
            if re.search(r"steam://|lutris:|heroic://", exec_line):
                continue
            if LAUNCHER_APPS.search(path.stem):
                continue  # the store apps themselves are not games
            try:
                argv = [a for a in shlex.split(exec_line) if not re.fullmatch(r"%[fFuUdDnNickvm]", a)]
            except ValueError:
                argv = []
            icons = resolve_icon(entry.get("Icon", ""))
            games[path.name] = {
                "id": f"desktop:{path.stem}",
                "title": entry.get("Name", path.stem),
                "source": "desktop",
                "launch": {"type": "desktop", "path": str(path), "argv": argv},
                "art": {"cover": [], "hero": [], "logo": [], "icon": icons},
            }
    return list(games.values())


# ---------------------------------------------------------------------------
# Custom (user added) and demo games
# ---------------------------------------------------------------------------
def custom_to_game(entry: dict) -> dict:
    return {
        "id": entry["id"],
        "title": entry["title"],
        "source": "custom",
        "launch": {"type": "cmd", "command": entry.get("command", "")},
        "art": {
            "cover": [entry["cover"]] if entry.get("cover") else [],
            "hero": [entry["hero"]] if entry.get("hero") else ([entry["cover"]] if entry.get("cover") else []),
            "logo": [],
            "icon": [],
        },
        "command": entry.get("command", ""),
    }


DEMO_STEAM = [
    ("1091500", "Cyberpunk 2077"), ("1245620", "ELDEN RING"), ("1086940", "Baldur's Gate 3"),
    ("292030", "The Witcher 3: Wild Hunt"), ("1174180", "Red Dead Redemption 2"), ("730", "Counter-Strike 2"),
    ("413150", "Stardew Valley"), ("367520", "Hollow Knight"), ("1145360", "Hades"),
    ("105600", "Terraria"), ("814380", "Sekiro: Shadows Die Twice"), ("620", "Portal 2"),
    ("1817070", "Marvel's Spider-Man Remastered"), ("990080", "Hogwarts Legacy"),
]


def demo_games() -> list:
    games = []
    for appid, title in DEMO_STEAM:
        games.append({
            "id": f"steam:{appid}",
            "title": title,
            "source": "steam",
            "launch": {"type": "demo"},
            "art": {
                "cover": [STEAM_CDN.format(appid=appid, name="library_600x900.jpg"),
                          STEAM_CDN_ALT.format(appid=appid, name="library_600x900.jpg")],
                "hero": [STEAM_CDN.format(appid=appid, name="library_hero.jpg"),
                         STEAM_CDN_ALT.format(appid=appid, name="library_hero.jpg")],
                "logo": [STEAM_CDN.format(appid=appid, name="logo.png"),
                         STEAM_CDN_ALT.format(appid=appid, name="logo.png")],
                "icon": [],
            },
        })
    return games


SCANNERS = {
    "steam": scan_steam,
    "heroic": scan_heroic,
    "lutris": scan_lutris,
    "desktop": scan_desktop,
}


def scan_all(sources: dict) -> list:
    games = []
    for name, scanner in SCANNERS.items():
        if not sources.get(name, True):
            continue
        try:
            games.extend(scanner())
        except Exception as exc:  # a broken store install should not break the launcher
            print(f"[gamehub] {name} scan failed: {exc}")
    return games
