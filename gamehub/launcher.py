"""Launching games, tracking what is running, and system status/power actions."""

import os
import shlex
import shutil
import subprocess
import threading
import time
from pathlib import Path


def _spawn(argv: list[str]) -> subprocess.Popen:
    return subprocess.Popen(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _open_uri(uri: str) -> subprocess.Popen:
    opener = shutil.which("xdg-open") or shutil.which("gio")
    if not opener:
        raise RuntimeError("xdg-open is not installed")
    argv = [opener, "open", uri] if opener.endswith("gio") else [opener, uri]
    return _spawn(argv)


def _steam_running_appids() -> set[str]:
    """Find Steam app ids of running games by scanning /proc environments."""
    found = set()
    uid = os.getuid()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != uid:
                continue
            env = (entry / "environ").read_bytes()
        except OSError:
            continue
        for var in env.split(b"\0"):
            if var.startswith(b"SteamGameId=") or var.startswith(b"SteamAppId="):
                value = var.split(b"=", 1)[1].decode(errors="ignore")
                if value.isdigit() and value != "0":
                    found.add(value)
    return found


class Launcher:
    def __init__(self, store, demo: bool = False):
        self.store = store
        self.demo = demo
        self.lock = threading.Lock()
        self.running: dict[str, dict] = {}  # game id -> {title, started, proc, kind}
        threading.Thread(target=self._monitor, daemon=True).start()

    # ---- launching ------------------------------------------------------
    def launch(self, game: dict):
        launch = game["launch"]
        kind = launch.get("type")
        proc = None
        if self.demo or kind == "demo":
            pass
        elif kind == "uri":
            _open_uri(launch["uri"])
        elif kind == "desktop":
            gio = shutil.which("gio")
            if gio:
                proc = _spawn([gio, "launch", launch["path"]])
            else:
                proc = _spawn(launch["argv"])
        elif kind == "cmd":
            argv = launch.get("argv") or shlex.split(launch["command"])
            if not argv:
                raise RuntimeError("This game has no launch command")
            proc = _spawn(argv)
        else:
            raise RuntimeError(f"Unknown launch type: {kind}")

        self.store.record_launch(game["id"])
        with self.lock:
            self.running[game["id"]] = {
                "title": game["title"],
                "started": time.time(),
                "proc": proc,
                "steamAppId": launch.get("steamAppId"),
                "seen": False,
                "demo": self.demo or kind == "demo",
            }

    # ---- monitoring -----------------------------------------------------
    def _monitor(self):
        while True:
            time.sleep(3)
            try:
                self._tick()
            except Exception as exc:  # never let the monitor die
                print(f"[gamehub] monitor error: {exc}")

    def _tick(self):
        with self.lock:
            entries = list(self.running.items())
        if not entries:
            return
        steam_ids = None
        now = time.time()
        finished = []
        for game_id, info in entries:
            alive = False
            if info["demo"]:
                alive = now - info["started"] < 20
            elif info["steamAppId"]:
                if steam_ids is None:
                    steam_ids = _steam_running_appids()
                alive = info["steamAppId"] in steam_ids
                if alive:
                    info["seen"] = True
                elif not info["seen"] and now - info["started"] < 90:
                    alive = True  # Steam may still be starting the game
            elif info["proc"] is not None:
                alive = info["proc"].poll() is None
            else:
                # Launched through a URI handler we cannot track; show it briefly.
                alive = now - info["started"] < 15
            if not alive:
                finished.append((game_id, info))
        for game_id, info in finished:
            with self.lock:
                self.running.pop(game_id, None)
            tracked = info["proc"] is not None or info["seen"]
            if tracked:
                self.store.add_playtime(game_id, now - info["started"])

    def running_games(self) -> list[dict]:
        with self.lock:
            return [
                {"id": gid, "title": info["title"], "started": int(info["started"])}
                for gid, info in self.running.items()
            ]


# ---- system status -------------------------------------------------------
def battery_status() -> dict | None:
    root = Path("/sys/class/power_supply")
    if not root.exists():
        return None
    for supply in root.iterdir():
        try:
            if (supply / "type").read_text().strip() != "Battery":
                continue
            if (supply / "scope").exists() and (supply / "scope").read_text().strip() == "Device":
                continue
            capacity = int((supply / "capacity").read_text().strip())
            status = (supply / "status").read_text().strip()
            return {"level": capacity, "charging": status in ("Charging", "Full")}
        except (OSError, ValueError):
            continue
    return None


def network_status() -> dict:
    root = Path("/sys/class/net")
    wifi = wired = False
    try:
        for iface in root.iterdir():
            if iface.name == "lo":
                continue
            try:
                up = (iface / "operstate").read_text().strip() == "up"
            except OSError:
                continue
            if not up:
                continue
            if (iface / "wireless").exists():
                wifi = True
            elif (iface / "device").exists():
                wired = True
    except OSError:
        pass
    return {"online": wifi or wired, "type": "wired" if wired else ("wifi" if wifi else "none")}


POWER_COMMANDS = {
    "suspend": ["systemctl", "suspend"],
    "reboot": ["systemctl", "reboot"],
    "shutdown": ["systemctl", "poweroff"],
}


def power_action(action: str):
    argv = POWER_COMMANDS.get(action)
    if not argv:
        raise RuntimeError(f"Unknown power action: {action}")
    _spawn(argv)
