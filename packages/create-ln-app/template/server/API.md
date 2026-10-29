# API server contract

The API server is the only part of the app that talks to the nodes. The browser sends all requests to this server. The node credentials (the LND macaroons and the CLN runes) and the TLS certs stay on the server.

The API is the same for each node implementation. Each node client in `server/nodes/` maps the data, the errors, and the invoice states of its node to one set. `server/nodes/types.ts` has the set.

- Base URL: `http://localhost:3001/api`. The `API_PORT` variable in `.env` changes the port.
- Start: `npm run server`, or `npm run dev` for the server and the app.
- The server reads `.env` one time at start. After `npm run network` or `npm run reset`, restart the server.
- A node name is the lowercase `<NAME>` of an `LND_<NAME>_REST_URL` or a `CLN_<NAME>_REST_URL` key in `.env`. The server uses an LND client or a CLN client for the node. The default nodes are `alice`, `bob`, and `carol`. `network/nodes.json` lists the nodes.
- All amounts are in satoshis and are JSON numbers. A field name with an amount ends in `Sats`.
- All hashes, preimages, and public keys are lowercase hex strings.
- A request body must be a JSON object. Send the header `content-type: application/json`.

## Endpoints

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| `GET` | `/health` | none | 200 |
| `GET` | `/nodes` | none | 200 |
| `POST` | `/nodes/:name/peers` | `{ peer }` | 200 |
| `POST` | `/nodes/:name/channels` | `{ peer, amountSats }` | 201 |
| `POST` | `/mine` | `{ blocks }` | 200 |
| `POST` | `/nodes/:name/invoices` | `{ amountSats, memo? }` | 201 |
| `GET` | `/nodes/:name/invoices/:hash` | none | 200 |
| `POST` | `/nodes/:name/payments` | `{ paymentRequest }` | 201 |

### `GET /health`

Shows that the server runs. The server does not call the nodes for this endpoint.

```json
{ "status": "ok" }
```

### `GET /nodes`

Shows each node, its balances, and its channels.

```json
[
  {
    "name": "alice",
    "impl": "lnd",
    "pubkey": "02ab...",
    "alias": "alice",
    "onchainBalanceSats": 4999000000,
    "channelBalanceSats": 995530,
    "channels": [
      {
        "channelPoint": "7fc1...4d41:0",
        "peerPubkey": "03cd...",
        "status": "active",
        "capacitySats": 1000000,
        "localBalanceSats": 995530,
        "remoteBalanceSats": 1000
      }
    ]
  }
]
```

- `impl` is the node implementation: `lnd` or `cln`. The server sends the nodes in name order.
- `onchainBalanceSats` is the confirmed wallet balance. An unconfirmed output, for example the change of a channel open, is not in it.
- `channelBalanceSats` is the local balance of all open channels.
- `status` is `pending`, `active`, or `inactive`. A `pending` channel waits for its funding transaction to confirm.
- To find the name of a peer, compare `peerPubkey` with the `pubkey` of each node in the same response.

### `POST /nodes/:name/peers`

Connects the node to another node.

- Body: `{ "peer": "bob" }`. The peer is the name of another node.
- Success: 200 `{ "peer": "bob", "peerPubkey": "03cd..." }`.
- If the nodes are already connected, the server also sends 200.
- The server gets the peer address from the first URI of the peer. If the peer has no URI, the server sends 502.

### `POST /nodes/:name/channels`

Opens a channel from the node to a peer. The node funds the channel from its on-chain wallet.

- Body: `{ "peer": "bob", "amountSats": 1000000 }`. `amountSats` is an integer from 1 to 2,100,000,000,000,000.
- Success: 201 `{ "channelPoint": "<txid>:<index>", "peer": "bob", "peerPubkey": "03cd..." }`.
- Connect the nodes with `POST /nodes/:name/peers` before you open the channel. If the nodes are not connected, the node rejects the request.
- LND rejects a channel of less than 20,000 sats.
- The channel is `pending` until its funding transaction confirms. Mine 6 blocks to make it `active`.

### `POST /mine`

Mines blocks on the regtest chain.

- Body: `{ "blocks": 6 }`. `blocks` is an integer from 1 to 1000.
- Success: 200 `{ "height": 109, "blockHashes": ["..."] }`.
- The block rewards go to a burn address. No node gets them.
- The server does not wait for the nodes to sync. To see a change, poll `GET /nodes`. A channel is `active` about 1 second after the blocks.

### `POST /nodes/:name/invoices`

Makes an invoice on the node.

- Body: `{ "amountSats": 1000, "memo": "coffee" }`. `amountSats` is an integer from 1 to 2,100,000,000,000,000. `memo` is an optional string. The default memo is `""`.
- LND rejects a memo of more than 1024 bytes.
- Success: 201 with the invoice. The invoice has the same fields as in `GET /nodes/:name/invoices/:hash`.

### `GET /nodes/:name/invoices/:hash`

Shows an invoice of the node. The hash is the `paymentHash` of the invoice: 64 hex characters.

```json
{
  "paymentHash": "702e...9fb5",
  "paymentRequest": "lnbcrt10u1...",
  "memo": "coffee",
  "amountSats": 1000,
  "amountPaidSats": 1000,
  "status": "settled",
  "createdAt": "2026-10-28T15:36:31.000Z",
  "settledAt": "2026-10-28T15:36:38.000Z"
}
```

- `status` is one of these values:
  - `open`: the invoice is not paid.
  - `accepted`: the node holds the payment, but did not settle it.
  - `settled`: the invoice is paid.
  - `canceled`: no one can pay the invoice, for example because it expired.
- `settledAt` is `null` if the invoice is not settled.
- If the node has no invoice with the hash, the server sends 404 with the code `not_found`.

### `POST /nodes/:name/payments`

Pays an invoice from the node.

- Body: `{ "paymentRequest": "lnbcrt10u1..." }`.
- Success: 201 `{ "paymentHash": "702e...", "preimage": "0141...", "amountSats": 1000, "feeSats": 0 }`.
- The server sends the reply after the payment succeeds or fails. The node tries for a maximum of 60 seconds.
- The maximum routing fee is 1,000 sats.
- The server cannot pay an invoice with no amount, because the body has no amount field. The node rejects the request.
- A failed payment gives 502 with a payment code (see [Errors](#errors)). For example, the code `no_route` gives the error `alice: the payment failed: no_route`.
- After a new channel becomes `active`, LND can need about 1 second more before it can send a payment over the channel. Before that, the payment fails with the code `insufficient_balance`. If the node has other channels, the code is `no_route`. Send the same payment request again.
- CLN sends the code `no_route` also if the channels do not have the balance for the payment.
- If the invoice is already paid, the server sends 409 with the code `conflict`.

## Errors

An error body has this shape:

```json
{ "error": "alice: the payment failed: no_route", "code": "no_route", "node": "alice" }
```

- `error` is a message for a person. Show it to the user.
- `code` is a code from the table below. Use the code in the app logic, not the `error` text. The codes are the same for each node implementation.
- `node` is the node that sent the error: a node name or `bitcoind`. If the error comes from the server, the body has no `node`.

| Code | Status | Cause |
| --- | --- | --- |
| `invalid_request` | 400 | The server or the node rejected a value in the body or the path. |
| `not_found` | 404 | The node, the path, or the object (for example, an invoice) does not exist. |
| `conflict` | 409 | The request conflicts with the node state, for example the invoice is already paid. |
| `no_route` | 502 | The payment found no route to the payee. |
| `insufficient_balance` | 502 | The channels do not have the balance for the payment. |
| `payment_timeout` | 502 | The payment did not succeed in 60 seconds. |
| `payment_rejected` | 502 | The payee rejected the payment, for example because the invoice expired. |
| `payment_failed` | 502 | The payment failed for a different reason. |
| `node_error` | 502 | The node or bitcoind sent a different error. |
| `node_unreachable` | 502 | The node or bitcoind did not reply. |
| `internal_error` | 500 | The server has a bug. The server log has the details. |

LND sends most errors as HTTP 500. Thus the server cannot tell a bad request from a node fault, and it sends `node_error` for both. Read `error` to find the cause. Examples of `node_error` errors for a bad request:

- `bob: self-payments not allowed`
- `alice: invalid bech32 string length 3`
- `alice: channel is too small, the minimum channel size is: 20000 SAT`

CLN sends `invalid_request` if a param is bad, for example `bob: Invalid bolt11 invoice: Bad bech32 string`. CLN sends `node_error` for other errors, for example `bob: Unable to connect, no address known for peer`.
