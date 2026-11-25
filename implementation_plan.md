# Gestalter desktop implementation plan

## Linux slice

Gestalter 0.1.0 opens to Notes. Create a note, write Markdown, and switch to **Preview** to read it. The first non-empty Markdown line supplies the list title. Save explicitly, leave the editor field, switch routes, or close the window to persist edits. Search matches Markdown text. The editor can attach PNG, JPEG, GIF, and WebP images up to 12 MiB each, link to other notes, and delete a note after confirmation. Existing typed references display their target label when available. The note editor is a reusable React component.

**Recent practice** shows up to 100 distinct facts and skills, ordered by their latest attempt time. It resolves each target by the pair `(kind, id)`. A score of zero and an omitted score both count on an attempt. Engagements and topic targets never populate the list. The timestamp is displayed in local time and retained in UTC in the stored record.

A normal launch opens the learner's database at `$XDG_DATA_HOME/gestalter/learner.sqlite3` or `~/.local/share/gestalter/learner.sqlite3`. Notes, typed references, practice records, and image bytes live in SQLite. Sign in through **Account** to receive practice automatically from vizint. **Import practice records** remains available for existing JSON exports. The import accepts learning events, facts, skills, and topics, and merges them by typed identity. A new learner database starts empty.

Python owns SQLite and executes each write transaction. Electron serves a bundled React, Tailwind, daisyUI, and Lucide frontend on an app-only protocol. The renderer reaches Python through a scoped Electron IPC bridge and the service's private standard streams. The Linux data directory, bundled Python command, native file input, and Debian staging script each have their own adapter.

## Install and run

On a Debian-style x86-64 Linux desktop, run from the project root:

```sh
sudo apt install ./release/gestalter-desktop_0.1.0_amd64.deb
gestalter
```

The installed desktop entry is **Gestalter**. The package bundles Electron 44.4.1 and a relocatable CPython 3.12.12 with SQLite. Runtime assumptions include glibc 2.34 or later, a graphical session, and the desktop libraries declared in the package. The package installs the Chromium sandbox helper root-owned with mode 4755. Running an extracted copy directly requires working unprivileged user namespaces or an equivalent Chromium sandbox setup. Ubuntu 26.04.1 x86-64 is the host used for the package checks. Other distribution versions and architectures remain unverified.

To develop or rebuild, use Node.js 22.12 or later, uv, and Debian packaging tools:

```sh
npm ci
uv python install 3.12.12
npm start
npm run package:linux
```

Development uses `python3` from PATH, or the interpreter set by `GESTALTER_PYTHON`. It needs SQLite with JSON operators. The package build uses uv's managed interpreter by default. Set `GESTALTER_PYTHON_ROOT` to a compatible standalone CPython 3.12.12 tree or `GESTALTER_ELECTRON_DIST` to an extracted Electron 44.4.1 Linux x86-64 distribution for offline staging. The local build used cached npm and Electron artifacts and the existing uv-managed interpreter. The `release/` directory contains the generated package.

## Verification

```sh
npm test
npm run test:package:storage
xvfb-run -a npm run test:package
# After installing the package, to use the installed sandbox helper:
GESTALTER_TEST_LAUNCHER=/usr/bin/gestalter xvfb-run -a npm run test:package
```

- **Passed** `npm test` against temporary SQLite databases. It checked note search and CRUD, preservation of unknown note properties, relationships, image byte persistence and cleanup, and rollback of an invalid import. It also checked latest-attempt ordering and a neutral engagement with a skill reference that produced no practice row.
- **Passed** `npm run test:package:storage` against the extracted package. The bundled React code ran in an emulated DOM with the packaged IPC client and Python runtime. It created a Markdown note through the editor, selected a PNG, flushed an edit on close, restarted the service, reopened the text and exact image bytes, and rendered the practice skill and timestamp. This test substitutes the renderer bridge for Electron IPC.
- **Passed** `dpkg-deb` inspection and `apt-get --simulate install ./release/gestalter-desktop_0.1.0_amd64.deb` on the host. The archive contains the launcher, desktop entry, bundled runtimes, and the root-owned Chromium sandbox helper.
- **Earlier environment limit.** The original Electron smoke test reached the extracted launcher. The managed execution environment denies Chromium's `shutdown` socket call before a window opens, including under Xvfb. The later integration checkpoint below exercised live Electron IPC. The smoke test supplies files through the file inputs.

The tests import [the unchanged thia-gestalts v1 examples](tests/fixtures/records.json) from commit `527c6982b508f9a6f873fdc47d5e2700dcfdad66`, the same schema pin used by vizint. The examples show **Round to the nearest ten** at `2025-10-09T08:53:20.000Z` and the associated fact. **Bézier Curves** is a neutral topic engagement and contributes no row.

## Remaining release work

1. Implement Zettelkasten placement using note relationships. Consult `plugins/zettelkasten` and `crates/core/src/outline.rs` for follows, branches, root selection, exclusions, missing parents, forks, and cycles.
2. Port the folder inbox behavior from `plugins/note-inbox`. Import direct UTF-8 files, skip empty or binary inputs, deduplicate by filename and content, and allow multiple notes from one imported item.
3. Implement the desktop academic schema, artifact references, BibTeX import/export, and duplicate reconciliation. Consult `packages/sources` and `plugins/source-manager`.
4. Verify a mobile image note and the installed package on a clean Linux system. Desktop and vizint interoperability is covered below.


## Olymp integration checkpoint · 2026-11-25

The Account route supports enrollment, sign-in and sign-out. Set `OLYMP_ORIGIN` when launching to select the service (default `http://127.0.0.1:8787`, HTTPS outside loopback). Electron forwards the app's same-origin API requests to that service. The session and non-extractable unlock key survive restart in Chromium IndexedDB. Signed-out work remains in the original local workspace. Each signed-in workspace has its own SQLite database under `gestalter/accounts/`, scoped to the service origin and account ID.

Normal editor mutations use the same Python validation and SQL edit methods as guest notes. A proposed change runs in a rollback savepoint so Olymp can encrypt any new images first. SQLite then commits the new manifest and the Notes/Recent practice projection together. The manifest retains opaque records, file references and concurrent branches. The UI omits unresolved branches and asks the learner to reopen an editor whose observed version has changed. Conflict-resolution UI remains open.

| Tested product | Git revision |
|---|---|
| Gestalter desktop | `d037aabf5d701dee1305a7fcd61b05f36ff0a84a` |
| Olymp | `35fbb66e284caa1e93c56ad6863b2c233b81fe6a` |
| vizint | `90f5cf48d7b79a79e166f6274910c6d1d4c48906` |

The standalone build verified the vendored Olymp 1.1.0 archive with SHA-256 `4266f2c8533f31e2b440879b96615abfefd3fc850ad85e3234c58dbc8b443c14`. The rebuilt Debian package SHA-256 was `73c86b6b660016ac824829bae2ba03122711dcaee2a5063f90277a4a47a18d04`.

```sh
npm ci
npm run build
npm test
npm run package:linux
npm run test:package:storage
# Point this at the installed or staged launcher with a configured sandbox helper
GESTALTER_TEST_LAUNCHER=/usr/bin/gestalter xvfb-run -a npm run test:package
# From thia-olymp after building vizint and the service
GESTALTER_TEST_LAUNCHER=/usr/bin/gestalter xvfb-run -a node tests/products.mjs
```

The standalone build passed `npm ci --offline --no-audit --no-fund && npm run build` using the populated npm cache. The packaged storage regression and live Electron note CRUD, image restart and practice regressions all passed. The corrected Debian launcher selected the bundled interpreter with the development interpreter set to an unavailable path.

The extracted-package run used live Electron IPC, bundled Python, and a root-owned Chromium sandbox helper supplied by the host. Olymp's implementation plan records the staging command. With Recent practice already open, an offline vizint attempt appeared automatically after reconnect, with its original event ID and time. Dropping the publication response produced one event and one displayed row. The note editor then saved a four-chunk PNG. Vizint resumed the interrupted download after restart, and the two clients confirmed revision 3 with identical manifests. The restarted editor reopened the original Markdown and 936,914 image bytes from SQLite. Sign-out reopened the guest workspace. A clean system installation, interactive OS picker and visual review remain unverified.
