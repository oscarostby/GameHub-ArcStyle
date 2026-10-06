"""Native desktop shell: a GTK 4 window with an embedded WebKit view.

The UI is rendered by WebKitGTK inside GameHub's own window (no browser),
and controllers are read natively through libmanette so they work the same
on every distro, then forwarded to the UI as navigation actions.
"""

import json
import os

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, Gio, GLib, Gtk  # noqa: E402

try:
    gi.require_version("WebKit", "6.0")
    from gi.repository import WebKit  # noqa: E402
except (ValueError, ImportError):
    WebKit = None

try:
    gi.require_version("Manette", "0.2")
    from gi.repository import Manette  # noqa: E402
except (ValueError, ImportError):
    Manette = None

from . import __version__  # noqa: E402

APP_ID = "io.github.oscarostby.GameHubArcStyle"
ICON_NAME = "gamehub-arcstyle"

# Linux input codes that libmanette reports for standard controller buttons.
BUTTONS = {
    0x130: "accept",   # BTN_SOUTH  (A / Cross)
    0x131: "back",     # BTN_EAST   (B / Circle)
    0x134: "x",        # BTN_WEST   (X / Square)
    0x133: "y",        # BTN_NORTH  (Y / Triangle)
    0x136: "lb", 0x137: "rb", 0x138: "lt", 0x139: "rt",
    0x13A: "select", 0x13B: "start", 0x13C: "guide",
    0x220: "up", 0x221: "down", 0x222: "left", 0x223: "right",
}
STICK_X, STICK_Y, TRIGGER_L, TRIGGER_R = 0, 1, 2, 5
HAT_X, HAT_Y = 16, 17
REPEATABLE = {"up", "down", "left", "right", "lt", "rt"}
REPEAT_DELAY_MS = 380
REPEAT_RATE_MS = 95
DEADZONE = 0.55


def controller_family(name: str) -> str:
    n = name.lower()
    if any(k in n for k in ("xbox", "xinput", "microsoft")):
        return "xbox"
    if any(k in n for k in ("playstation", "dualsense", "dualshock", "sony", "wireless controller", "ps4", "ps5")):
        return "playstation"
    if any(k in n for k in ("nintendo", "pro controller", "joy-con")):
        return "nintendo"
    return "xbox"


class Controllers:
    """Reads every connected controller via libmanette and emits UI actions."""

    def __init__(self, emit, connection, is_active):
        self.emit = emit
        self.connection = connection
        self.is_active = is_active
        self.held: dict[str, int] = {}       # action -> GLib timeout id (0 = no repeat)
        self.axis_state: dict[tuple, str] = {}
        self.devices = []
        self.suppress_until = 0
        self.monitor = Manette.Monitor.new()
        self.monitor.connect("device-connected", lambda _m, d: self._add(d, announce=True))
        self.monitor.connect("device-disconnected", self._removed)
        it = self.monitor.iterate()
        while True:
            ok, device = it.next()
            if not ok or device is None:
                break
            self._add(device, announce=False)

    @property
    def connected(self) -> bool:
        return bool(self.devices)

    def _add(self, device, announce):
        self.devices.append(device)
        device.connect("button-press-event", self._on_button, True)
        device.connect("button-release-event", self._on_button, False)
        device.connect("absolute-axis-event", self._on_axis)
        device.connect("hat-axis-event", self._on_hat)
        if announce:
            self.connection(True, device.get_name() or "Controller")

    def _removed(self, _monitor, device):
        if device in self.devices:
            self.devices.remove(device)
        self.connection(False, device.get_name() or "Controller")

    def rumble(self, strong=0.8, weak=0.5, ms=260):
        for device in self.devices:
            try:
                if device.has_rumble():
                    device.rumble(int(strong * 0xFFFF), int(weak * 0xFFFF), ms)
            except Exception:
                pass

    # ---- events -----------------------------------------------------
    def _family(self, device):
        return controller_family(device.get_name() or "")

    def _press(self, action, device):
        if action in self.held:
            return
        if not self.is_active() or GLib.get_monotonic_time() < self.suppress_until:
            self.held[action] = 0  # swallow until released
            return
        self.emit(action, self._family(device), False)
        timer = 0
        if action in REPEATABLE:
            timer = GLib.timeout_add(REPEAT_DELAY_MS, self._start_repeat, action, device)
        self.held[action] = timer

    def _start_repeat(self, action, device):
        if action not in self.held:
            return False
        self.held[action] = GLib.timeout_add(REPEAT_RATE_MS, self._repeat, action, device)
        return False

    def _repeat(self, action, device):
        if action not in self.held or not self.is_active():
            return False
        self.emit(action, self._family(device), True)
        return True

    def _release(self, action):
        timer = self.held.pop(action, 0)
        if timer:
            GLib.source_remove(timer)

    def _on_button(self, device, event, pressed):
        ok, code = event.get_button()
        action = BUTTONS.get(code) if ok else None
        if not action:
            return
        if pressed:
            self._press(action, device)
        else:
            self._release(action)

    def _directional(self, device, key, value, neg, pos, threshold):
        current = self.axis_state.get(key)
        new = neg if value < -threshold else pos if value > threshold else None
        if new == current:
            return
        if current:
            self._release(current)
        if new:
            self._press(new, device)
        self.axis_state[key] = new

    def _on_axis(self, device, event):
        ok, axis, value = event.get_absolute()
        if not ok:
            return
        key = (id(device), axis)
        if axis == STICK_X:
            self._directional(device, key, value, "left", "right", DEADZONE)
        elif axis == STICK_Y:
            self._directional(device, key, value, "up", "down", DEADZONE)
        elif axis in (TRIGGER_L, TRIGGER_R):
            action = "lt" if axis == TRIGGER_L else "rt"
            # Triggers rest at -1 or 0 depending on the driver.
            self._directional(device, key, value, None, action, 0.5)

    def _on_hat(self, device, event):
        ok, axis, value = event.get_hat()
        if not ok:
            return
        key = (id(device), "hat", axis)
        if axis == HAT_X:
            self._directional(device, key, value, "left", "right", 0.5)
        elif axis == HAT_Y:
            self._directional(device, key, value, "up", "down", 0.5)


class GameHubWindow:
    def __init__(self, application, url, fullscreen, debug, quit_cb):
        self.quit_cb = quit_cb
        self.window = Gtk.ApplicationWindow(application=application, title="GameHub ArcStyle")
        self.window.set_icon_name(ICON_NAME)
        self.window.set_default_size(1600, 900)

        css = Gtk.CssProvider()
        css.load_from_string("window, .gamehub-bg { background: #05070d; }")
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        self.view = WebKit.WebView()
        self.view.set_background_color(Gdk.RGBA(red=0.02, green=0.027, blue=0.05, alpha=1))
        settings = self.view.get_settings()
        settings.set_enable_developer_extras(debug)
        settings.set_media_playback_requires_user_gesture(False)
        settings.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.ALWAYS)
        if hasattr(settings, "set_enable_back_forward_navigation_gestures"):
            settings.set_enable_back_forward_navigation_gestures(False)
        if not debug:
            self.view.connect("context-menu", lambda *_: True)
        self.view.connect("decide-policy", self._on_policy, url)
        self.view.connect("web-process-terminated", lambda *_: self.view.reload())

        # Bridge between the page and the native shell.
        self.controllers = Controllers(self._send_action, self._send_connection, self.window.is_active) if Manette else None
        manager = self.view.get_user_content_manager()
        flags = {"native": True, "gamepad": self.controllers is not None, "version": __version__}
        manager.add_script(WebKit.UserScript.new(
            f"window.__GAMEHUB_NATIVE__ = {json.dumps(flags)};",
            WebKit.UserContentInjectedFrames.TOP_FRAME,
            WebKit.UserScriptInjectionTime.START,
            None, None,
        ))
        manager.register_script_message_handler("gamehub", None)
        manager.connect("script-message-received::gamehub", self._on_message)

        self.window.set_child(self.view)
        self.window.connect("notify::is-active", self._on_active)
        self.window.connect("close-request", lambda *_: (self.quit_cb(), False)[1])

        keys = Gtk.EventControllerKey()
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        keys.connect("key-pressed", self._on_key)
        self.window.add_controller(keys)

        self.view.load_uri(url)
        if fullscreen:
            self.window.fullscreen()
        self.window.present()
        self.view.grab_focus()

    # ---- page <-> native -------------------------------------------
    def _js(self, code):
        self.view.evaluate_javascript(code, -1, None, None, None, None, None)

    def _send_action(self, action, family, repeat):
        self._js(f"window.gamehubNative && window.gamehubNative.action({json.dumps(action)}, {json.dumps(family)}, {str(repeat).lower()})")

    def _send_connection(self, connected, name):
        self._js(f"window.gamehubNative && window.gamehubNative.connection({str(connected).lower()}, {json.dumps(name)}, {len(self.controllers.devices)})")

    def _on_message(self, _manager, value):
        try:
            message = json.loads(value.to_string())
        except (ValueError, AttributeError):
            return
        if os.environ.get("GAMEHUB_DEBUG"):
            print(f"[gamehub] page -> app: {message}")
        kind = message.get("type")
        if kind == "fullscreen":
            self.toggle_fullscreen()
        elif kind == "rumble" and self.controllers:
            self.controllers.rumble(message.get("strong", 0.8), message.get("weak", 0.5), message.get("ms", 260))
        elif kind == "quit":
            self.quit_cb()
        elif kind == "ready" and self.controllers:
            self._send_connection(self.controllers.connected, ", ".join(d.get_name() or "" for d in self.controllers.devices))

    def toggle_fullscreen(self):
        if self.window.is_fullscreen():
            self.window.unfullscreen()
        else:
            self.window.fullscreen()

    def _on_key(self, _ctrl, keyval, _code, state):
        if keyval == Gdk.KEY_F11:
            self.toggle_fullscreen()
            return True
        if keyval in (Gdk.KEY_q, Gdk.KEY_Q) and state & Gdk.ModifierType.CONTROL_MASK:
            self.quit_cb()
            return True
        return False

    def _on_active(self, *_):
        if self.window.is_active() and self.controllers:
            # Ignore buttons still held from the game we just left.
            self.controllers.suppress_until = GLib.get_monotonic_time() + 400_000

    def _on_policy(self, _view, decision, decision_type, home):
        # Keep the UI on the local server; open any other link externally.
        if decision_type == WebKit.PolicyDecisionType.NAVIGATION_ACTION:
            uri = decision.get_navigation_action().get_request().get_uri()
            if not uri.startswith(home):
                decision.ignore()
                Gio.AppInfo.launch_default_for_uri(uri, None)
                return True
        return False


_quit_hook = None
_application = None


def request_quit():
    """Thread-safe: ask the running window to close."""
    if _quit_hook:
        GLib.idle_add(_quit_hook)


def _get_application():
    global _application
    if _application is None:
        GLib.set_prgname(ICON_NAME)
        GLib.set_application_name("GameHub ArcStyle")
        _application = Gtk.Application(application_id=APP_ID, flags=Gio.ApplicationFlags.DEFAULT_FLAGS)
        _application.register(None)
    return _application


def activate_existing() -> bool:
    """If GameHub is already running, bring it to the front and return True."""
    app = _get_application()
    if app.get_is_remote():
        app.run([])  # forwards "activate" to the running instance and returns
        return True
    return False


def run(url: str, fullscreen: bool, debug: bool, on_quit) -> int:
    """Run the native window until it is closed. Returns an exit code."""
    global _quit_hook
    application = _get_application()

    def quit_all():
        on_quit()
        application.quit()
        return False

    def activate(app):
        existing = getattr(app, "gamehub_window", None)
        if existing:
            # Launched again (e.g. Super+O): jump back to the front, full screen.
            if fullscreen:
                existing.window.fullscreen()
            existing.window.present()
            existing.view.grab_focus()
        elif WebKit is None:
            show_missing_deps(app)
        else:
            app.gamehub_window = GameHubWindow(app, url, fullscreen, debug, quit_all)

    _quit_hook = quit_all
    application.connect("activate", activate)
    return application.run([])


def install_hint() -> str:
    try:
        with open("/etc/os-release", encoding="utf-8") as f:
            info = f.read().lower()
    except OSError:
        info = ""
    if "arch" in info or "cachyos" in info or "manjaro" in info or "endeavouros" in info:
        return "sudo pacman -S --needed webkitgtk-6.0 libmanette"
    if "ubuntu" in info or "debian" in info or "mint" in info or "pop" in info:
        return "sudo apt install gir1.2-webkit-6.0 gir1.2-manette-0.2"
    return "install WebKitGTK 6.0 (webkitgtk-6.0) and libmanette for your distribution"


def show_missing_deps(app):
    window = Gtk.ApplicationWindow(application=app, title="GameHub ArcStyle")
    window.set_default_size(620, 260)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
    for side in ("top", "bottom", "start", "end"):
        getattr(box, f"set_margin_{side}")(28)
    title = Gtk.Label(xalign=0)
    title.set_markup("<span size='x-large' weight='bold'>One more step</span>")
    text = Gtk.Label(xalign=0, wrap=True, label="GameHub needs WebKitGTK to draw its interface. Install it with:")
    cmd = Gtk.Label(xalign=0, selectable=True)
    cmd.set_markup(f"<tt>{GLib.markup_escape_text(install_hint())}</tt>")
    close = Gtk.Button(label="Close", halign=Gtk.Align.END)
    close.connect("clicked", lambda *_: app.quit())
    for widget in (title, text, cmd, close):
        box.append(widget)
    window.set_child(box)
    window.present()


def available() -> bool:
    return WebKit is not None

