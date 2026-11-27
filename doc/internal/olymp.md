# Connect Gestalter Desktop to Olymp

From this checkout, install dependencies with `npm ci`, then launch:

```sh
OLYMP_ORIGIN=https://gestalter.koljasam.com npm start
```

Installed Linux packages connect to `https://gestalter.koljasam.com` out of the box. Open **Account** and sign in with your Olymp login, or create an account if you are new to Olymp. To use a different server, provide its HTTPS origin through `OLYMP_ORIGIN` without a `/v1/` suffix. A checkout launched without `OLYMP_ORIGIN` uses `http://127.0.0.1:8787`.

When the Olymp domain changes, wait for all devices to finish syncing to the old origin. Fully quit Gestalter, update `OLYMP_ORIGIN` in the launch command or launcher, then relaunch and sign in. Desktop scopes its session and local replica by Olymp origin, so it downloads the synced base again. Check your notes and attachments before retiring the old endpoint.

When moving the service to a new VPS, preserve the Olymp SQLite database and its matching `opaque-setup-v1` from `/var/lib/olymp`. They keep existing accounts and synced data available at the new HTTPS endpoint.
