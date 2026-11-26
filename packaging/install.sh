#!/bin/sh
set -eu

if [ "$(uname -s)" != Linux ]; then
    echo "This installer supports Fedora and Ubuntu on Linux." >&2
    exit 1
fi

arch=$(uname -m)
case "$arch" in
    x86_64) deb_arch=amd64 ;;
    aarch64) deb_arch=arm64 ;;
    *) echo "This installer supports x86_64 and ARM64." >&2; exit 1 ;;
esac

. /etc/os-release
case "${ID:-}" in
    ubuntu) format=deb ;;
    fedora)
        format=rpm
        if ! command -v rpmbuild >/dev/null 2>&1; then
            sudo dnf install rpm-build
        fi
        ;;
    *) echo "This installer supports Fedora and Ubuntu." >&2; exit 1 ;;
esac

if [ -z "${GESTALTER_PYTHON_ROOT:-}" ]; then
    python=$(node -p 'require("./packaging/runtime.json").python')
    uv python install --no-bin "$python"
fi

output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT
# Let apt's unprivileged download user read the local package.
chmod 755 "$output"
npm ci --include=dev
npm run package:linux -- "$format" "$output"
version=$(node -p 'require("./package.json").version')

case "$format" in
    deb)
        sudo apt-get install --reinstall --allow-downgrades "$output/gestalter-desktop_${version}_${deb_arch}.deb"
        ;;
    rpm)
        package="$output/gestalter-desktop-$version-1.$arch.rpm"
        nevra=$(rpm -qp --queryformat '%{NEVRA}' "$package")
        if rpm -q "$nevra" >/dev/null 2>&1; then
            sudo dnf reinstall "$package"
        else
            sudo dnf install "$package"
        fi
        ;;
esac
