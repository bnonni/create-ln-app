# Example app

The example app for create-ln-app. It uses Vite, React, TypeScript, and plain CSS.

## Commands

Run these commands in this folder:

```sh
npm run dev         # start the app at http://localhost:5173
npm run build       # type check, then write the production build to dist/
npm run preview     # serve the production build
npm run lint        # oxlint, zero warnings allowed
npm run typecheck   # TypeScript, no emit
```

The app sends each `/api` request to the API server. The Vite dev server proxies `/api` to `http://localhost:3001`. To use a different port, set `API_PORT` in the root `.env`.

To start the regtest network, the API server, and the app together, run `npm run dev` in the root folder.
