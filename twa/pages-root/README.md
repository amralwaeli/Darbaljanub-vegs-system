# Pages root — makes the APK open as a real app

## Why this folder exists

The APK is a Trusted Web Activity. Chrome only drops the address bar and runs it
full-screen if it can verify that this Android package really owns the website.
It verifies by fetching **one file, from the root of the origin**:

```
https://amralwaeli.github.io/.well-known/assetlinks.json
```

That URL currently returns **404**, so verification fails and Chrome falls back
to a Custom Tab — a browser tab with a URL bar. That is the "it works like a
website, not an app" problem, and it also makes launching slower.

The path is fixed by Android: it is always `<origin>/.well-known/assetlinks.json`.
It is **not** `…/Darbaljanub-vegs-system/.well-known/…`. Because the app is a
GitHub Pages *project* site, the origin root belongs to a *user* site, which is a
separate repository — hence this folder.

## Publish it (about 3 minutes, once)

1. Create a **public** repo named exactly `amralwaeli.github.io`.
2. Upload the contents of this folder to the repo root, keeping the structure:
   `.well-known/assetlinks.json`, `.nojekyll`, `index.html`, and
   `.github/workflows/deploy.yml`.
3. Settings → Pages → Source: **GitHub Actions** (the included workflow
   publishes the directory as-is; no build step). If you prefer branch
   deploys, choose "Deploy from a branch" → `main` → `/ (root)` instead — the
   `.nojekyll` file is there so either source works.
4. Wait for the deploy, then confirm the file is live:

   ```
   https://amralwaeli.github.io/.well-known/assetlinks.json
   ```

   It must return the JSON, served as `application/json`.

`.nojekyll` is **required**: GitHub Pages runs Jekyll by default, and Jekyll
silently skips folders whose name starts with a dot — including `.well-known`.
Without it the file will 404 even after you upload it.

## Then re-verify on the phone

Chrome caches the verification result, so an already-installed APK will not
re-check on its own:

1. Uninstall the app.
2. Reinstall `twa/DarbAlJanub-Vegs.apk`.
3. Launch it — no address bar should appear.

The APK itself does not need rebuilding. Its signing certificate already matches
the fingerprint in `assetlinks.json`:

```
43:23:04:AA:99:0F:68:06:E3:20:27:85:AE:82:30:7C:17:2E:44:DB:54:70:6F:66:ED:EE:6C:74:50:E4:78:B1
```

Verify at any time with:

```
keytool -printcert -jarfile twa/DarbAlJanub-Vegs.apk
```

If you ever re-sign the APK with a different keystore, copy the new SHA-256 into
`.well-known/assetlinks.json` and re-publish, or verification breaks again.
