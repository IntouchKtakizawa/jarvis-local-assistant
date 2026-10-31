# GitHub Pages deployment

The repository uses `.github/workflows/pages.yml` to test and build the static interface on pushes to main. In Settings → Pages, select **GitHub Actions** as the source. The build uploads only `dist/`; this folder is generated from `public/` and selected installed browser libraries.

Run `npm ci`, `npm test`, and `npm run build:pages` to verify locally. Never upload `.local/`, `.env`, `models/`, `node_modules/`, `work/` or `outputs/`.

The backend remains on the Mac at http://127.0.0.1:3210/. Generate a one-time pairing code in the local app and enter it in the hosted interface. The backend accepts only the configured exact web origin and a valid paired-browser token. Account sign-in and pairing administration remain local. GitHub Pages cannot execute the Node backend.
