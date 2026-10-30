# Network reference

Run the commands in this file in the project folder, not in `network/`.

The network has 1 bitcoind node and the Lightning nodes in `network/nodes.json`. `npm run compose` writes `network/docker-compose.yml` from the list. The Docker Compose project name comes from the `name` in `package.json`. Node data goes to `network/data/`.

To start the network and wait until all nodes are healthy, run:

```sh
docker compose -f network/docker-compose.yml up -d --wait
```

To use `lncli` in an LND node, run the command as the `lnd` user (replace `alice` with the node name):

```sh
docker compose -f network/docker-compose.yml exec -u lnd alice lncli -n regtest getinfo
```

To use `lightning-cli` in a CLN node, run the command as the `clightning` user:

```sh
docker compose -f network/docker-compose.yml exec -u clightning alice lightning-cli --network=regtest getinfo
```

To use `eclair-cli` in an Eclair node, give the API password with `-p`:

```sh
docker compose -f network/docker-compose.yml exec alice eclair-cli -p eclairpw getinfo
```

## Change the nodes

`network/nodes.json` has 2 to 10 nodes. Each node has a name and an impl: `lnd` (LND), `cln` (Core Lightning), or `eclair` (Eclair). A network can have more than one impl. To make a project with only CLN nodes, add `--impl cln` to the `create-ln-app` command. For only Eclair nodes, add `--impl eclair`. This example has one node of each impl:

```json
[
  { "name": "alice", "impl": "lnd" },
  { "name": "bob", "impl": "cln" },
  { "name": "carol", "impl": "eclair" }
]
```

A name starts with a lowercase letter and has only lowercase letters and digits. Each name must be unique. The name `bitcoind` is not permitted.

To add or remove a node:

1. Run `npm run down`.
2. Edit `network/nodes.json`.
3. Run `npm run dev`. The network starts the new nodes, funds them, and writes them to `.env`.

Do not edit `network/docker-compose.yml`. The next `npm run compose` replaces it. If you remove a node, its data stays in `network/data/`. `npm run reset` deletes it.

## LND

The host ports of a node come from its position in `network/nodes.json`, not from its name. `.env` has the REST URL of each node.

| Node | REST | gRPC | P2P |
|---|---|---|---|
| 1 (alice) | `https://127.0.0.1:8081` | `127.0.0.1:10001` | `9735` |
| 2 (bob) | `https://127.0.0.1:8082` | `127.0.0.1:10002` | `9736` |
| 3 (carol) | `https://127.0.0.1:8083` | `127.0.0.1:10003` | `9737` |
| n | `https://127.0.0.1:<8080+n>` | `127.0.0.1:<10000+n>` | `<9734+n>` |

Each node writes its admin macaroon and TLS cert here (replace `alice` with the node name):

```
network/data/alice/data/chain/bitcoin/regtest/admin.macaroon
network/data/alice/tls.cert
```

LND REST calls must send the macaroon in hex in the `Grpc-Metadata-macaroon` header. To get the hex value, run:

```sh
xxd -ps -u -c 1000 network/data/alice/data/chain/bitcoin/regtest/admin.macaroon
```

API reference: [LND REST API](https://lightning.engineering/api-docs/api/lnd/).

## Core Lightning (CLN)

A CLN node uses the same host ports as an LND node in the same position. The REST API is CLNRest. The CLNRest TLS cert names only `localhost`, so use `localhost` in the URL, not `127.0.0.1`.

| Node | REST | gRPC | P2P |
|---|---|---|---|
| 1 (alice) | `https://localhost:8081` | `localhost:10001` | `9735` |
| n | `https://localhost:<8080+n>` | `localhost:<10000+n>` | `<9734+n>` |

`npm run env` writes these keys to `.env` for each CLN node (replace `ALICE` with the node name in uppercase):

- `CLN_ALICE_REST_URL`: the CLNRest URL.
- `CLN_ALICE_RUNE`: a rune with no restrictions. It gives full control of the node, like an LND admin macaroon. `npm run env` uses the first rune of this type, or makes one.
- `CLN_ALICE_TLS_CERT_PATH`: the path of the CA cert that signs the CLNRest TLS cert. The node writes the cert to `network/data/alice/regtest/ca.pem`.

A CLNRest call is a `POST` to `/v1/<method>`, with the rune in the `Rune` header and the parameters in a JSON body. Example:

```sh
set -a; . ./.env; set +a
curl --cacert "$CLN_ALICE_TLS_CERT_PATH" -X POST -H "Rune: $CLN_ALICE_RUNE" \
  -H 'content-type: application/json' -d '{}' "$CLN_ALICE_REST_URL/v1/getinfo"
```

API reference: [CLNRest](https://docs.corelightning.org/docs/rest).

## Eclair

An Eclair node uses the REST host port and the P2P host port of an LND node in the same position. It has no gRPC port. The Eclair API uses plain HTTP, so it has no TLS cert.

| Node | API | P2P |
|---|---|---|
| 1 (alice) | `http://127.0.0.1:8081` | `9735` |
| n | `http://127.0.0.1:<8080+n>` | `<9734+n>` |

`npm run env` writes these keys to `.env` for each Eclair node (replace `ALICE` with the node name in uppercase):

- `ECLAIR_ALICE_API_URL`: the Eclair API URL.
- `ECLAIR_ALICE_API_PASSWORD`: the API password. It gives full control of the node, like an LND admin macaroon. All Eclair nodes have the password `eclairpw`.

An Eclair node has no wallet of its own. It uses the bitcoind wallet with the node name, for example `alice`.

An Eclair API call is a `POST` to `/<method>`, with the password in HTTP basic auth and an empty user name. Send the parameters as form fields, for example `-d amountMsat=1000000`. Example:

```sh
set -a; . ./.env; set +a
curl -u ":$ECLAIR_ALICE_API_PASSWORD" -X POST "$ECLAIR_ALICE_API_URL/getinfo"
```

API reference: [Eclair API](https://acinq.github.io/eclair/).

## bitcoind

- RPC: `http://127.0.0.1:18443`, user `polaruser`, password `polarpass`.
- REST: `http://127.0.0.1:18443/rest/`.

API reference: [Bitcoin Core REST interface](https://github.com/bitcoin/bitcoin/blob/master/doc/REST-interface.md).
