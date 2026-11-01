# Use a real wallet

The example app pays with the nodes of your project. This page tells how to pay with a real wallet: a WebLN browser extension, or a wallet app that reads a Lightning Address or a withdraw link.

## The wallet must be on the network of the nodes

A wallet can pay an invoice only on its own network.

- Regtest (the default): the chain is on your computer, and only the nodes of your project are on it. A mainnet wallet cannot pay a regtest invoice. A wallet can pay only if it uses a node of your project. `network/README.md` of your project has the host ports and the API keys of the nodes.
- A public test network or mainnet: each wallet on the same network can pay. The plan for Mutinynet (a public signet) is in [ROADMAP.md](../ROADMAP.md#m13-mutinynet-branch-m13-mutinynet).

## Pay with a WebLN extension

Step 5 of the page pays with WebLN (<https://www.webln.guide>). `frontend/src/webln.ts` is a WebLN provider for development: the selected node is the wallet. A WebLN extension, for example Alby, sets `window.webln`. That provider has the same calls.

1. Connect the extension to a wallet on the network of the nodes.
2. In `frontend/src/components/Page.tsx`, step 5, replace `nodeProvider(name)` with `window.webln ?? nodeProvider(name)`. In the `next-ts` template, the file is `src/components/Page.tsx`.
3. Click "Pay invoice". The extension asks you to accept the payment.

## Use a Lightning Address or a withdraw link in a wallet app

A wallet app gets the URL of the LNURL service from the Lightning Address or the withdraw link. LUD-01 allows only https with a valid certificate. Thus the app must be on a domain with https. In this example, the domain is `lapp.example.com`.

1. Get a domain with https that sends the requests to your computer. Use a server with a proxy, or a tunnel service.
2. Set up the proxy. The proxy must do these 3 things:
   - End TLS, and send all requests to the app: port 5173 for the `react-ts` and `react` templates, or port 3000 for the `next-ts` template.
   - Keep the `Host` header of the request.
   - Set the header `X-Forwarded-Proto: https`.
3. Allow the domain in the dev server, then restart the dev server:
   - `react-ts` and `react`: in `frontend/vite.config.ts`, add `allowedHosts: ['lapp.example.com']` to `server`.
   - `next-ts`: in `next.config.ts`, add `allowedDevOrigins: ['lapp.example.com']`.
4. Open <https://lapp.example.com>. The Lightning Address of the node `bob` is `bob@lapp.example.com`. Step 7 makes withdraw links with https URLs.

Caddy keeps the `Host` header and sets `X-Forwarded-Proto` by default. This `Caddyfile` gets a certificate for the domain and sends the requests to the Vite dev server:

```text
lapp.example.com {
  reverse_proxy localhost:5173
}
```

With nginx, add `proxy_set_header Host $host;` and `proxy_set_header X-Forwarded-Proto $scheme;` to the `location` block.

The server makes the LNURL URLs from the `Host` header and the `X-Forwarded-Proto` header (`publicUrl` in `server/lnurl.ts`). If the proxy does not set `X-Forwarded-Proto`, the URLs have `http`, and a wallet app does not accept them.

`npm run build` makes static files with no proxy. To serve the build of a `react-ts` or `react` project, the proxy must send `/api/` and `/.well-known/` to the API server (port 3001) and serve the files in `frontend/dist/`. In a `next-ts` project, `npm run start` serves the app and the API on port 3000.

## Security

The proxy makes the API server public. The API has no authentication. Thus each person who can open the domain can make your nodes pay invoices and open channels.

- Use a public domain only on a test network, and only for a test.
- Stop the proxy or the tunnel after the test.
- Before you use mainnet, add authentication to the API.
