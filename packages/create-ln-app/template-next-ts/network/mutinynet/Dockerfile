# The Mutinynet bitcoind: the polarlightning/bitcoind image with the binaries of the Mutinynet fork.
# Stock Bitcoin Core cannot sync Mutinynet, because it has no signetblocktime option.
# The fork release is Bitcoin Inquisition 29.2.0 from https://github.com/benthecarman/bitcoin/releases.
# The entrypoint, the USERID and GROUPID settings, and the data dir of the base image do not change.
# If you change this file, change MUTINYNET_IMAGE in scripts/compose.ts.
FROM debian:trixie-slim AS fetch
ARG TARGETARCH
ARG FORK_TAG=mutinynet-inq-template-hash
ARG FORK_VERSION=2fda7bfc027e
ARG SHA256_AMD64=c76b58a078e3e5fcc4597f50d9f9d15da8d11a5d8cf0831ab62970329bfb6115
ARG SHA256_ARM64=c18705e9e98202e095e13bbc5546b5f34fbb4df9bf8bc34ef4553f6d2d1d68bc
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) triplet=x86_64-linux-gnu; sha=$SHA256_AMD64 ;; \
      arm64) triplet=aarch64-linux-gnu; sha=$SHA256_ARM64 ;; \
      *) echo "No Mutinynet build for $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    file="bitcoin-$FORK_VERSION-$triplet.tar.gz"; \
    curl -fsSL --retry 3 -o "$file" "https://github.com/benthecarman/bitcoin/releases/download/$FORK_TAG/$file"; \
    echo "$sha  $file" | sha256sum -c -; \
    mkdir /out; \
    tar -xzf "$file" -C /out --strip-components=2 "bitcoin-$FORK_VERSION/bin/bitcoind" "bitcoin-$FORK_VERSION/bin/bitcoin-cli"

FROM polarlightning/bitcoind:30.0
COPY --from=fetch /out/ /opt/mutinynet/bin/
ENV PATH=/opt/mutinynet/bin:$PATH
