"""Persistent state: settings, per-game metadata (favorites, playtime) and custom games."""

import json
import os
import threading
import time
from pathlib import Path


def data_dir() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    path = Path(base) / "gamehub-arcstyle"
    path.mkdir(parents=True, exist_ok=True)
    return path


DEFAULT_SETTINGS = {
    "accent": "#00d4ff",
    "background": "hero",        # hero | aurora | solid
    "sounds": True,
    "volume": 0.6,
    "rumble": True,
    "clock24": True,
    "showHidden": False,
    "hideOnLaunch": True,
    "sources": {"steam": True, "heroic": True, "epic": True, "lutris": True, "mods": True,
                "launchers": True, "desktop": True, "apps": True},
}


class Store:
    def __init__(self, path: Path | None = None):
        self.path = path or data_dir() / "state.json"
        self.lock = threading.RLock()
        self.data = {"settings": {}, "meta": {}, "custom": []}
        self.load()

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                self.data.update(loaded)
        except FileNotFoundError:
            pass
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[gamehub] could not read {self.path}: {exc}")

    def save(self):
        with self.lock:
            tmp = self.path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)
            os.replace(tmp, self.path)

    # ---- settings -------------------------------------------------------
    def settings(self) -> dict:
        merged = json.loads(json.dumps(DEFAULT_SETTINGS))
        stored = self.data.get("settings", {})
        for key, value in stored.items():
            if key == "sources" and isinstance(value, dict):
                merged["sources"].update(value)
            elif key in merged:
                merged[key] = value
        return merged

    def update_settings(self, patch: dict) -> dict:
        with self.lock:
            stored = self.data.setdefault("settings", {})
            for key, value in patch.items():
                if key not in DEFAULT_SETTINGS:
                    continue
                if key == "sources" and isinstance(value, dict):
                    stored.setdefault("sources", {}).update(
                        {k: bool(v) for k, v in value.items() if k in DEFAULT_SETTINGS["sources"]}
                    )
                else:
                    stored[key] = value
            self.save()
        return self.settings()

    # ---- per-game metadata ---------------------------------------------
    def meta(self, game_id: str) -> dict:
        return self.data.setdefault("meta", {}).setdefault(
            game_id, {"favorite": False, "hidden": False, "playtime": 0, "lastPlayed": 0, "launches": 0}
        )

    def update_meta(self, game_id: str, patch: dict) -> dict:
        with self.lock:
            meta = self.meta(game_id)
            for key in ("favorite", "hidden"):
                if key in patch:
                    meta[key] = bool(patch[key])
            self.save()
            return dict(meta)

    def record_launch(self, game_id: str):
        with self.lock:
            meta = self.meta(game_id)
            meta["lastPlayed"] = int(time.time())
            meta["launches"] = meta.get("launches", 0) + 1
            self.save()

    def add_playtime(self, game_id: str, seconds: float):
        if seconds <= 0:
            return
        with self.lock:
            meta = self.meta(game_id)
            meta["playtime"] = int(meta.get("playtime", 0) + seconds)
            meta["lastPlayed"] = int(time.time())
            self.save()

    # ---- custom games ---------------------------------------------------
    def custom_games(self) -> list:
        return list(self.data.setdefault("custom", []))

    def add_custom(self, game: dict) -> dict:
        with self.lock:
            entry = {
                "id": f"custom:{int(time.time() * 1000)}",
                "title": str(game.get("title", "")).strip()[:120] or "Untitled",
                "command": str(game.get("command", "")).strip(),
                "cover": str(game.get("cover", "")).strip(),
                "hero": str(game.get("hero", "")).strip(),
            }
            self.data.setdefault("custom", []).append(entry)
            self.save()
            return entry

    def remove_custom(self, game_id: str) -> bool:
        with self.lock:
            before = len(self.data.get("custom", []))
            self.data["custom"] = [g for g in self.data.get("custom", []) if g.get("id") != game_id]
            self.data.get("meta", {}).pop(game_id, None)
            self.save()
            return len(self.data["custom"]) != before
