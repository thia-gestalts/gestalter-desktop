Name: gestalter-desktop
Version: %{gestalter_version}
Release: 1
Summary: Local-first Markdown notes, academic sources and recent learner practice
License: LicenseRef-Not-Specified

# Ship the upstream Electron and Python runtimes as built, with explicit
# runtime requirements so optional Python modules do not pull in system Python.
AutoReqProv: no
%global debug_package %{nil}
%global __os_install_post %{nil}
Requires: alsa-lib, at-spi2-core, cairo, cups-libs, dbus-libs, expat, glib2
Requires: glibc >= 2.34, gtk3, libatomic, libdrm, libgcc, libstdc++, libxkbcommon
Requires: libX11, libxcb, libXcomposite, libXdamage, libXext, libXfixes, libXrandr
Requires: mesa-libgbm, nspr, nss, pango, systemd-libs

%description
Gestalter Desktop bundles Electron and Python for local-first Markdown notes,
academic sources and recent learner practice.

%install
mkdir -p "%{buildroot}"
cp -a "%{gestalter_stage}/." "%{buildroot}/"

%files
%defattr(-,root,root,-)
/opt/gestalter
/usr/bin/gestalter
/usr/share/applications/gestalter.desktop
