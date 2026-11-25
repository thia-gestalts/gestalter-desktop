#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
    echo "The initial package targets Linux x86_64." >&2
    exit 1
fi

version=$(node -p 'require("./package.json").version')
python=$(node -p 'require("./packaging/runtime.json").python')
if [ -z "${GESTALTER_PYTHON_ROOT:-}" ]; then
    python_bin=$(uv python find --managed-python "$python")
    GESTALTER_PYTHON_ROOT=$(dirname "$(dirname "$python_bin")")
fi
"$GESTALTER_PYTHON_ROOT/bin/python3" -c "
import sqlite3, sys, unicodedata
assert sys.version.split()[0] == '$python'
assert unicodedata.unidata_version == '16.0.0'
sqlite3.connect(':memory:').execute(\"SELECT '{}' ->> 'x'\")
"

electron=${GESTALTER_ELECTRON_DIST:-node_modules/electron/dist}
if [ ! -x "$electron/electron" ]; then
    echo "Install Electron with npm ci or set GESTALTER_ELECTRON_DIST to its extracted Linux distribution." >&2
    exit 1
fi

mkdir -p release
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/DEBIAN" "$stage/opt/gestalter" "$stage/usr/bin" "$stage/usr/share/applications"
cp -a "$electron/." "$stage/opt/gestalter/"
chmod 4755 "$stage/opt/gestalter/chrome-sandbox"

resources="$stage/opt/gestalter/resources"
app="$resources/app"
mkdir -p "$app/backend" "$resources/python"
cp -a "$GESTALTER_PYTHON_ROOT/." "$resources/python/"
cp -r desktop dist "$app/"
cp backend/*.py "$app/backend/"
cat > "$app/package.json" <<PACKAGE
{"name":"gestalter-desktop","productName":"Gestalter","version":"$version","main":"desktop/main.cjs"}
PACKAGE

install -m 755 packaging/gestalter "$stage/usr/bin/gestalter"
install -m 644 packaging/gestalter.desktop "$stage/usr/share/applications/gestalter.desktop"
cat > "$stage/DEBIAN/control" <<CONTROL
Package: gestalter-desktop
Version: $version
Section: education
Priority: optional
Architecture: amd64
Maintainer: Gestalter contributors
Depends: libc6 (>= 2.34), libasound2t64 | libasound2, libatomic1, libatk1.0-0t64 | libatk1.0-0, libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libcairo2, libcups2t64 | libcups2, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0t64 | libglib2.0-0, libgtk-3-0t64 | libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libudev1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2
Description: Local-first Markdown notes, academic sources and recent learner practice
CONTROL
dpkg-deb --root-owner-group -Z gzip -z3 --build "$stage" "release/gestalter-desktop_${version}_amd64.deb"
