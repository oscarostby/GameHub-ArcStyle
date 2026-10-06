#!/usr/bin/env bash
# Install GameHub ArcStyle as a desktop app for the current user.
#   ./install.sh              install dependencies (asks for sudo) and add it to the app menu
#   ./install.sh --autostart  also start GameHub when you log in
#   ./install.sh --uninstall  remove it from the app menu, autostart and the shortcut
# The Super+O (Windows key + O) shortcut is registered on KDE Plasma and GNOME.
set -euo pipefail

APP_ID="io.github.oscarostby.GameHubArcStyle"
ICON="gamehub-arcstyle"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
DESKTOP_FILE="$DATA/applications/$APP_ID.desktop"
ICON_FILE="$DATA/icons/hicolor/scalable/apps/$ICON.svg"
AUTOSTART_FILE="$CONFIG/autostart/$APP_ID.desktop"
BIN="$HOME/.local/bin/gamehub-arcstyle"
SHORTCUT="Meta+O"
GNOME_KEYS="org.gnome.settings-daemon.plugins.media-keys"
GNOME_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/gamehub-arcstyle/"

set_gnome_list() {  # add|remove our custom keybinding path in GNOME's list
  local current new
  current="$(gsettings get "$GNOME_KEYS" custom-keybindings)"
  new="$(python3 -c "
import ast, sys
raw = sys.argv[1].replace('@as ', '')
items = [i for i in ast.literal_eval(raw) if i != sys.argv[3]]
if sys.argv[2] == 'add': items.append(sys.argv[3])
print(str(items))" "$current" "$1" "$GNOME_PATH")"
  gsettings set "$GNOME_KEYS" custom-keybindings "$new"
}

shortcut() {  # install|remove the Super+O shortcut
  local desktop="${XDG_CURRENT_DESKTOP:-}"
  if [[ "$desktop" == *KDE* ]] && command -v kwriteconfig6 >/dev/null; then
    if [[ "$1" == install ]]; then
      kwriteconfig6 --file kglobalshortcutsrc --group services --group "$APP_ID.desktop" --key _launch "$SHORTCUT"
      echo "Shortcut: Super+O opens GameHub (KDE Plasma)."
    else
      kwriteconfig6 --file kglobalshortcutsrc --group services --group "$APP_ID.desktop" --key _launch --delete
    fi
    systemctl --user restart plasma-kglobalaccel.service 2>/dev/null || true
  elif command -v gsettings >/dev/null && gsettings list-schemas 2>/dev/null | grep -qx "$GNOME_KEYS"; then
    if [[ "$1" == install ]]; then
      set_gnome_list add
      gsettings set "$GNOME_KEYS.custom-keybinding:$GNOME_PATH" name "GameHub ArcStyle"
      gsettings set "$GNOME_KEYS.custom-keybinding:$GNOME_PATH" command "$BIN"
      gsettings set "$GNOME_KEYS.custom-keybinding:$GNOME_PATH" binding "<Super>o"
      echo "Shortcut: Super+O opens GameHub (GNOME)."
    else
      set_gnome_list remove
    fi
  elif [[ "$1" == install ]]; then
    echo "Add a keyboard shortcut for \"$BIN\" (Super+O) in your desktop's settings."
  fi
}

if [[ "${1:-}" == "--uninstall" ]]; then
  shortcut remove || true
  rm -f "$DESKTOP_FILE" "$ICON_FILE" "$AUTOSTART_FILE" "$BIN" "$DATA/applications/gamehub-arcstyle.desktop"
  echo "GameHub ArcStyle removed. Your settings are kept in $DATA/gamehub-arcstyle."
  exit 0
fi

have_deps() {
  python3 - <<'PY' 2>/dev/null
import gi
gi.require_version("Gtk", "4.0"); gi.require_version("WebKit", "6.0"); gi.require_version("Manette", "0.2")
from gi.repository import Gtk, WebKit, Manette
PY
}

if ! have_deps; then
  echo "Installing GameHub's dependencies (GTK 4, WebKitGTK, libmanette)…"
  if command -v pacman >/dev/null; then
    sudo pacman -S --needed --noconfirm python python-gobject gtk4 webkitgtk-6.0 libmanette
  elif command -v apt-get >/dev/null; then
    sudo apt-get update
    sudo apt-get install -y python3 python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-manette-0.2
  elif command -v dnf >/dev/null; then
    sudo dnf install -y python3 python3-gobject gtk4 webkitgtk6.0 libmanette
  else
    echo "Unknown distribution: please install GTK 4, WebKitGTK 6.0, libmanette and PyGObject yourself." >&2
  fi
fi

mkdir -p "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")" "$(dirname "$BIN")"
cp "$DIR/packaging/$ICON.svg" "$ICON_FILE"
chmod +x "$DIR/gamehub.py"
printf '#!/bin/sh\nexec python3 "%s/gamehub.py" "$@"\n' "$DIR" > "$BIN"
chmod +x "$BIN"
rm -f "$DATA/applications/gamehub-arcstyle.desktop"  # entry from older versions
sed "s|^Exec=.*|Exec=$BIN|" "$DIR/packaging/$APP_ID.desktop" > "$DESKTOP_FILE"

if [[ "${1:-}" == "--autostart" ]]; then
  mkdir -p "$(dirname "$AUTOSTART_FILE")"
  cp "$DESKTOP_FILE" "$AUTOSTART_FILE"
  echo "GameHub will start automatically when you log in."
fi

command -v update-desktop-database >/dev/null && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
shortcut install || echo "Could not register the Super+O shortcut automatically."
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q "$DATA/icons/hicolor" 2>/dev/null || true
echo "Installed! Press Super+O, open \"GameHub ArcStyle\" from your app menu, or run: gamehub-arcstyle"
