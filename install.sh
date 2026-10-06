#!/usr/bin/env bash
# Install GameHub ArcStyle into your app menu (per user, no root needed).
#   ./install.sh              add a menu entry
#   ./install.sh --autostart  also start GameHub when you log in
#   ./install.sh --uninstall  remove the menu entry and autostart entry
set -euo pipefail

APP_ID="gamehub-arcstyle"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
DESKTOP_FILE="$DATA/applications/$APP_ID.desktop"
ICON_FILE="$DATA/icons/hicolor/scalable/apps/$APP_ID.svg"
AUTOSTART_FILE="$CONFIG/autostart/$APP_ID.desktop"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$DESKTOP_FILE" "$ICON_FILE" "$AUTOSTART_FILE"
  echo "GameHub ArcStyle removed from the app menu."
  exit 0
fi

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

mkdir -p "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"
cp "$DIR/web/img/icon.svg" "$ICON_FILE"
chmod +x "$DIR/gamehub.py"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=GameHub ArcStyle
GenericName=Game Launcher
Comment=Console-style launcher for all your games
Exec=python3 "$DIR/gamehub.py"
Icon=$APP_ID
Terminal=false
Categories=Game;
Keywords=games;launcher;steam;controller;
StartupWMClass=GameHub
EOF

if [[ "${1:-}" == "--autostart" ]]; then
  mkdir -p "$(dirname "$AUTOSTART_FILE")"
  cp "$DESKTOP_FILE" "$AUTOSTART_FILE"
  echo "GameHub will start automatically when you log in."
fi

command -v update-desktop-database >/dev/null && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
echo "Installed. Launch \"GameHub ArcStyle\" from your app menu, or run: $DIR/gamehub.py"
