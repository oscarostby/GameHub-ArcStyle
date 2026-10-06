"""Command line entry point: start the server and open the UI full screen."""

import argparse
import shutil
import signal
import subprocess
import sys
import threading
import webbrowser

from . import __version__
from .server import App, serve
from .store import Store, data_dir

CHROMIUM_FAMILY = [
    "chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "brave", "brave-browser",
    "vivaldi-stable", "vivaldi", "microsoft-edge-stable", "thorium-browser",
]

FIREFOX_PREFS = {
    "browser.shell.checkDefaultBrowser": "false",
    "browser.aboutwelcome.enabled": "false",
    "browser.startup.homepage_override.mstone": '"ignore"',
    "datareporting.policy.dataSubmissionEnabled": "false",
    "toolkit.telemetry.reportingpolicy.firstRun": "false",
    "media.autoplay.default": "0",
    "media.autoplay.blocking_policy": "0",
    "dom.gamepad.enabled": "true",
    "browser.sessionstore.resume_from_crash": "false",
    "browser.tabs.warnOnClose": "false",
    "full-screen-api.warning.timeout": "0",
    "full-screen-api.transition-duration.enter": '"0 0"',
    "full-screen-api.transition-duration.leave": '"0 0"',
}


def open_window(url: str, windowed: bool) -> subprocess.Popen | None:
    """Open the UI in a dedicated, chrome-less browser window."""
    profile_root = data_dir() / "browser"
    for name in CHROMIUM_FAMILY:
        exe = shutil.which(name)
        if exe:
            argv = [
                exe, f"--app={url}", f"--user-data-dir={profile_root / 'chromium'}",
                "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
                "--disable-features=Translate", "--class=GameHub",
            ]
            if not windowed:
                argv += ["--start-fullscreen", "--kiosk"]
            return subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    firefox = shutil.which("firefox") or shutil.which("librewolf") or shutil.which("firefox-esr")
    if firefox:
        profile = profile_root / "firefox"
        profile.mkdir(parents=True, exist_ok=True)
        (profile / "user.js").write_text(
            "".join(f'user_pref("{k}", {v});\n' for k, v in FIREFOX_PREFS.items()), encoding="utf-8"
        )
        argv = [firefox, "--new-instance", "--profile", str(profile), "--class", "GameHub"]
        if not windowed:
            argv.append("--kiosk")
        argv.append(url)
        return subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    webbrowser.open(url)
    return None


def run_browser(httpd, args) -> int:
    """Fallback: show the UI in a chrome-less browser window."""
    browser = None

    def quit_app(*_):
        if browser and browser.poll() is None:
            browser.terminate()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    httpd.gamehub_app.on_quit = quit_app
    signal.signal(signal.SIGTERM, quit_app)
    if not args.no_browser:
        browser = open_window(httpd.gamehub_url, args.windowed)
        if browser:
            def watch_browser():
                browser.wait()
                print("[gamehub] window closed, shutting down")
                threading.Thread(target=httpd.shutdown, daemon=True).start()
            threading.Thread(target=watch_browser, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        quit_app()
    finally:
        httpd.server_close()
    return 0


def run_native(httpd, args) -> int:
    """Default: GameHub's own GTK window with an embedded WebKit view."""
    from . import native

    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def shutdown():
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    httpd.gamehub_app.on_quit = native.request_quit
    signal.signal(signal.SIGTERM, lambda *_: native.request_quit())
    signal.signal(signal.SIGINT, lambda *_: native.request_quit())
    try:
        return native.run(httpd.gamehub_url, fullscreen=not args.windowed, debug=args.debug, on_quit=shutdown,
                          running_games=httpd.gamehub_app.launcher.running_games)
    finally:
        httpd.server_close()


def main(argv=None):
    parser = argparse.ArgumentParser(prog="gamehub", description="Console-style game launcher")
    parser.add_argument("--windowed", action="store_true", help="start in a window instead of full screen")
    parser.add_argument("--demo", action="store_true", help="show a demo library instead of scanning")
    parser.add_argument("--browser", action="store_true", help="show the UI in a browser window instead of the native app")
    parser.add_argument("--no-browser", action="store_true", help="only start the server (implies --browser)")
    parser.add_argument("--port", type=int, default=47800, help="port to listen on (0 = random)")
    parser.add_argument("--debug", action="store_true", help="enable the web inspector (right click)")
    parser.add_argument("--version", action="version", version=f"GameHub ArcStyle {__version__}")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(line_buffering=True)

    use_browser = args.browser or args.no_browser
    if not use_browser:
        try:
            from . import native
        except (ImportError, ValueError):
            print("[gamehub] PyGObject/GTK 4 is missing. Install it (Arch: python-gobject gtk4, Ubuntu: python3-gi gir1.2-gtk-4.0),")
            print("[gamehub] or run with --browser to use a browser window instead.")
            return 1
        if native.activate_existing():
            print("[gamehub] already running - brought it to the front")
            return 0

    app = App(Store(), demo=args.demo)
    try:
        httpd = serve(app, args.port)
    except OSError:
        httpd = serve(app, 0)  # preferred port busy: pick a free one
    httpd.gamehub_app = app
    httpd.gamehub_url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"[gamehub] GameHub ArcStyle {__version__} running at {httpd.gamehub_url}")
    print(f"[gamehub] {len(app.library.games)} games in library")

    return run_browser(httpd, args) if use_browser else run_native(httpd, args)


if __name__ == "__main__":
    sys.exit(main())
