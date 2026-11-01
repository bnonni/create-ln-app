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

## WebLN

Step 5 pays the invoice with WebLN (https://www.webln.guide). `src/webln.ts` is a WebLN provider for development: the selected node is the wallet. It has the 4 calls that each WebLN provider has: `enable`, `getInfo`, `makeInvoice`, and `sendPayment`.

A wallet extension, for example Alby, sets `window.webln`. To pay with the wallet of the user, call `window.webln.enable()`, then use `window.webln` in place of `nodeProvider(name)`. The wallet must be on the same network as the invoice.
