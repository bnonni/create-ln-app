# API server contract

The API server is the only part of the app that talks to the nodes. The browser sends all requests to this server. The macaroons and the TLS certs stay on the server.

- Base URL: `http://localhost:3001/api`. The `API_PORT` variable in `.env` changes the port.
- Start: `npm run server`, or `npm run dev` for the server and the app.
- The server reads `.env` one time at start. After `npm run network` or `npm run reset`, restart the server.
- A node name is the lowercase `<NAME>` of an `LND_<NAME>_REST_URL` key in `.env`. The default nodes are `alice`, `bob`, and `carol`.
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
- Connect the nodes with `POST /nodes/:name/peers` before you open the channel. If the nodes are not connected, LND rejects the request.
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

- `status` is `open`, `accepted`, `settled`, or `canceled`.
- `settledAt` is `null` if the invoice is not settled.
- If the node has no invoice with the hash, the server sends 404.

### `POST /nodes/:name/payments`

Pays an invoice from the node.

- Body: `{ "paymentRequest": "lnbcrt10u1..." }`.
- Success: 201 `{ "paymentHash": "702e...", "preimage": "0141...", "amountSats": 1000, "feeSats": 0 }`.
- The server sends the reply after the payment succeeds or fails. The node tries for a maximum of 60 seconds.
- The maximum routing fee is 1,000 sats.
- The server cannot pay an invoice with no amount, because the body has no amount field. LND rejects the request.
- A failed payment gives 502. The error has the LND failure reason, for example `alice: the payment failed: FAILURE_REASON_NO_ROUTE`.
- If the invoice is already paid, the server sends 409.

## Errors

An error body has this shape:

```json
{ "error": "alice: the payment failed: FAILURE_REASON_NO_ROUTE", "node": "alice" }
```

- `error` is a message for a person. Show it to the user.
- `node` is the node that sent the error: a node name or `bitcoind`. If the error comes from the server, the body has no `node`.

| Status | Cause |
| --- | --- |
| 400 | The server or LND rejected the body or a path value. |
| 404 | The node, the path, or the LND object (for example, an invoice) does not exist. |
| 409 | LND found a conflict, for example an invoice that is already paid. |
| 502 | LND or bitcoind rejected the request, did not reply, or the payment failed. |
| 500 | The server has a bug. The server log has the details. |

LND sends most errors as HTTP 500. Thus the server cannot tell a bad request from a node fault, and it sends 502 for both. Read `error` to find the cause. Examples of 502 errors for a bad request:

- `bob: self-payments not allowed`
- `alice: invalid bech32 string length 3`
- `alice: channel is too small, the minimum channel size is: 20000 SAT`
