# Hosting the web demo

The web demo is a zero-backend, in-browser build of the dashboard (an in-memory mock + a guided
playground, no database, no server). It is plain static files, so you can host it anywhere.

## Build

```sh
cd web
npm ci                                              # or: bun install
VITE_TARGET=wasm VITE_BASE="/" npm run build        # -> web/dist
```

Set `VITE_BASE` to the sub-path it is served under: `/` for a domain root, or e.g. `/inspect/` if
served under that path.

## Cloudflare Pages

Connect the repo in the Cloudflare dashboard and set:

- **Build command:** `cd web && npm ci && VITE_TARGET=wasm npm run build`
- **Build output directory:** `web/dist`

Or deploy a local build directly with Wrangler:

```sh
cd web && npm ci && VITE_TARGET=wasm npm run build
npx wrangler pages deploy web/dist --project-name energydb-inspect
```

## Any other static host

Serve `web/dist/` as static files with an SPA fallback to `index.html` (Netlify, S3 + CloudFront,
GitHub Pages, etc.). For GitHub Pages also run `touch web/dist/.nojekyll`.
