"""Local HTTP server that serves the UI and a small JSON API.

The server only listens on 127.0.0.1. Every API call must carry the per-run
token that is embedded in the served page, and the Host header must match,
so other websites open in a browser cannot drive the launcher.
"""

import json
import mimetypes
import os
import secrets
import threading
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import __version__, launcher, scanners

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"
ART_KINDS = ("cover", "hero", "logo", "icon")


class Library:
    """Holds the scanned game list and the registry of local art files."""

    def __init__(self, store, demo=False):
        self.store = store
        self.demo = demo
        self.lock = threading.Lock()
        self.games: dict[str, dict] = {}
        self.local_art: dict[str, str] = {}  # key -> absolute path
        self.rescan()

    def rescan(self):
        sources = self.store.settings()["sources"]
        if self.demo:
            # Demo games, plus the real apps on this PC so the Apps tab can be tried too.
            found = scanners.demo_games() + (scanners.scan_apps() if sources.get("apps", True) else [])
        else:
            found = scanners.scan_all(sources)
        found += [scanners.custom_to_game(c) for c in self.store.custom_games()]
        games, art = {}, {}
        for game in found:
            public_art = {}
            for kind in ART_KINDS:
                urls = []
                for item in game["art"].get(kind, []):
                    if item.startswith(("http://", "https://")):
                        urls.append(item)
                    elif item.startswith("/") and os.path.isfile(item):
                        key = secrets.token_hex(8)
                        art[key] = item
                        urls.append(f"/art/{key}")
                public_art[kind] = urls
            game["publicArt"] = public_art
            games[game["id"]] = game
        with self.lock:
            self.games = games
            self.local_art = art

    def get(self, game_id):
        with self.lock:
            return self.games.get(game_id)

    def public_list(self):
        with self.lock:
            games = list(self.games.values())
        out = []
        for g in games:
            meta = self.store.meta(g["id"])
            out.append({
                "id": g["id"],
                "title": g["title"],
                "source": g["source"],
                "art": g["publicArt"],
                "favorite": meta.get("favorite", False),
                "hidden": meta.get("hidden", False),
                "playtime": meta.get("playtime", 0),
                "lastPlayed": meta.get("lastPlayed", 0),
                "launches": meta.get("launches", 0),
                "size": g.get("size", 0),
                "command": g.get("command"),
                "kind": "app" if g["source"] == "app" else "game",
                "category": g.get("category"),
                "description": g.get("description"),
            })
        out.sort(key=lambda g: g["title"].lower())
        return out

    def art_path(self, key):
        with self.lock:
            return self.local_art.get(key)


class App:
    def __init__(self, store, demo=False):
        self.store = store
        self.demo = demo
        self.token = secrets.token_urlsafe(24)
        self.library = Library(store, demo)
        self.launcher = launcher.Launcher(store, demo)
        self.on_quit = None


def make_handler(app: App, port: int):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        server_version = f"GameHub/{__version__}"

        def log_message(self, fmt, *args):
            if os.environ.get("GAMEHUB_DEBUG"):
                super().log_message(fmt, *args)

        # ---- helpers ----------------------------------------------------
        def _send(self, status, body: bytes, ctype="application/json", extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            # Only artwork may be cached; the UI files must always be fresh after an update.
            self.send_header("Cache-Control", "max-age=3600" if ctype.startswith("image/") else "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, data, status=HTTPStatus.OK):
            self._send(status, json.dumps(data).encode())

        def _error(self, status, message):
            self._json({"error": message}, status)

        def _host_ok(self):
            return self.headers.get("Host", "") in allowed_hosts

        def _authorized(self):
            return self._host_ok() and secrets.compare_digest(self.headers.get("X-GameHub-Token", ""), app.token)

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > 1_000_000:
                raise ValueError("Request too large")
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw or b"{}")
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
            return data

        # ---- routing ----------------------------------------------------
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            if not self._host_ok():
                return self._error(HTTPStatus.FORBIDDEN, "Bad host")
            path = urllib.parse.urlparse(self.path).path
            if path.startswith("/api/"):
                if not self._authorized():
                    return self._error(HTTPStatus.UNAUTHORIZED, "Missing token")
                if path == "/api/state":
                    return self._json(self._state())
                if path == "/api/status":
                    return self._json(self._status())
                return self._error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            if path.startswith("/art/"):
                return self._serve_art(path[len("/art/"):])
            return self._serve_static(path)

        def do_POST(self):
            if not self._authorized():
                return self._error(HTTPStatus.UNAUTHORIZED, "Missing token")
            path = urllib.parse.urlparse(self.path).path
            try:
                body = self._body()
            except (ValueError, json.JSONDecodeError) as exc:
                return self._error(HTTPStatus.BAD_REQUEST, str(exc))
            try:
                handler = {
                    "/api/launch": self._launch,
                    "/api/meta": self._meta,
                    "/api/settings": self._settings,
                    "/api/rescan": self._rescan,
                    "/api/custom/add": self._custom_add,
                    "/api/custom/remove": self._custom_remove,
                    "/api/power": self._power,
                }.get(path)
                if not handler:
                    return self._error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
                return self._json(handler(body))
            except LookupError as exc:
                return self._error(HTTPStatus.NOT_FOUND, str(exc))
            except (RuntimeError, OSError, ValueError) as exc:
                return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

        # ---- API handlers -----------------------------------------------
        def _state(self):
            return {
                "version": __version__,
                "demo": app.demo,
                "games": app.library.public_list(),
                "settings": app.store.settings(),
                "user": os.environ.get("USER", "player"),
                "hostname": os.uname().nodename,
            }

        def _status(self):
            return {
                "running": app.launcher.running_games(),
                "battery": launcher.battery_status(),
                "network": launcher.network_status(),
            }

        def _launch(self, body):
            game = app.library.get(body.get("id"))
            if not game:
                raise LookupError("Game not found")
            app.launcher.launch(game)
            return {"ok": True}

        def _meta(self, body):
            game_id = body.get("id")
            if not app.library.get(game_id):
                raise LookupError("Game not found")
            return {"ok": True, "meta": app.store.update_meta(game_id, body)}

        def _settings(self, body):
            before = app.store.settings()["sources"]
            settings = app.store.update_settings(body)
            if settings["sources"] != before:
                app.library.rescan()
            return {"ok": True, "settings": settings}

        def _rescan(self, _body):
            app.library.rescan()
            return {"ok": True, "games": app.library.public_list()}

        def _custom_add(self, body):
            if not str(body.get("title", "")).strip():
                raise ValueError("A title is required")
            if not str(body.get("command", "")).strip():
                raise ValueError("A launch command is required")
            entry = app.store.add_custom(body)
            app.library.rescan()
            return {"ok": True, "id": entry["id"], "games": app.library.public_list()}

        def _custom_remove(self, body):
            if not app.store.remove_custom(str(body.get("id", ""))):
                raise LookupError("Custom game not found")
            app.library.rescan()
            return {"ok": True, "games": app.library.public_list()}

        def _power(self, body):
            action = body.get("action")
            if action == "quit":
                if app.on_quit:
                    threading.Timer(0.3, app.on_quit).start()
                return {"ok": True}
            launcher.power_action(action)
            return {"ok": True}

        # ---- files ------------------------------------------------------
        def _serve_art(self, key):
            path = app.library.art_path(key)
            if not path or not os.path.isfile(path):
                return self._error(HTTPStatus.NOT_FOUND, "No art")
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            if not ctype.startswith("image/"):
                return self._error(HTTPStatus.FORBIDDEN, "Not an image")
            with open(path, "rb") as f:
                self._send(HTTPStatus.OK, f.read(), ctype)

        def _serve_static(self, path):
            if path in ("", "/"):
                path = "/index.html"
            target = (WEB_ROOT / path.lstrip("/")).resolve()
            if WEB_ROOT not in target.parents or not target.is_file():
                return self._error(HTTPStatus.NOT_FOUND, "Not found")
            data = target.read_bytes()
            ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            if target.name == "index.html":
                data = data.replace(b"__GAMEHUB_TOKEN__", app.token.encode())
                ctype = "text/html; charset=utf-8"
            elif ctype in ("text/css", "text/javascript", "application/javascript"):
                ctype += "; charset=utf-8"
            self._send(HTTPStatus.OK, data, ctype)

    return Handler


def serve(app: App, port: int = 0) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer(("127.0.0.1", port), None)
    httpd.RequestHandlerClass = make_handler(app, httpd.server_address[1])
    httpd.daemon_threads = True
    return httpd
