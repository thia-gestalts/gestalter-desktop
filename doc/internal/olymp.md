# Connect Gestalter Desktop to Olymp

From this checkout, install dependencies with `npm ci`, then launch:

```sh
OLYMP_ORIGIN=https://gestalter.koljasam.com npm start
```

For an installed build, set the same environment variable in the launcher that starts Gestalter. Without it, the app uses `http://127.0.0.1:8787`. Open **Account** and sign in with your Olymp login, or create an account if you are new to Olymp. Supply the HTTPS origin without a `/v1/` suffix.

When the Olymp domain changes, wait for all devices to finish syncing to the old origin. Fully quit Gestalter, update `OLYMP_ORIGIN` in the launch command or launcher, then relaunch and sign in. Desktop scopes its session and local replica by Olymp origin, so it downloads the synced base again. Check your notes and attachments before retiring the old endpoint.

When moving the service to a new VPS, preserve the Olymp SQLite database and its matching `opaque-setup-v1` from `/var/lib/olymp`. They keep existing accounts and synced data available at the new HTTPS endpoint.
