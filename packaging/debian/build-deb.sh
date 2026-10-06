#!/usr/bin/env bash
# Build a .deb for Ubuntu 24.04+ / Debian 13+:
#   packaging/debian/build-deb.sh
#   sudo apt install ./gamehub-arcstyle_<version>_all.deb
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(python3 -c "import sys; sys.path.insert(0, '$ROOT'); import gamehub; print(gamehub.__version__)")"
PKG="gamehub-arcstyle"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
STAGE="$BUILD/${PKG}_${VERSION}_all"

install -d "$STAGE/DEBIAN" "$STAGE/usr/share/$PKG"
cp -r "$ROOT/gamehub" "$ROOT/web" "$ROOT/gamehub.py" "$STAGE/usr/share/$PKG/"
find "$STAGE" -name '__pycache__' -prune -exec rm -rf {} +
install -Dm755 "$ROOT/packaging/gamehub-arcstyle.sh" "$STAGE/usr/bin/$PKG"
install -Dm644 "$ROOT/packaging/io.github.oscarostby.GameHubArcStyle.desktop" "$STAGE/usr/share/applications/io.github.oscarostby.GameHubArcStyle.desktop"
install -Dm644 "$ROOT/packaging/io.github.oscarostby.GameHubArcStyle.desktop" "$STAGE/usr/share/kglobalaccel/io.github.oscarostby.GameHubArcStyle.desktop"
install -Dm644 "$ROOT/packaging/gamehub-arcstyle.svg" "$STAGE/usr/share/icons/hicolor/scalable/apps/$PKG.svg"

cat > "$STAGE/DEBIAN/control" <<CONTROL
Package: $PKG
Version: $VERSION
Section: games
Priority: optional
Architecture: all
Depends: python3 (>= 3.10), python3-gi, gir1.2-gtk-4.0, gir1.2-webkit-6.0, gir1.2-manette-0.2
Suggests: steam, lutris
Maintainer: oscarostby <oscarostby@users.noreply.github.com>
Homepage: https://github.com/oscarostby/GameHub-ArcStyle
Description: Console-style launcher for all the games on your PC
 A full-screen, controller-friendly game hub in the style of Steam Big
 Picture that collects Steam, Heroic (Epic/GOG), Lutris and desktop games.
CONTROL

dpkg-deb --build --root-owner-group "$STAGE" "$ROOT/${PKG}_${VERSION}_all.deb"
echo "Built $ROOT/${PKG}_${VERSION}_all.deb"
