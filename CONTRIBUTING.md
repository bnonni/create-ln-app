# Contributing

## Set up

1. Install [Node.js](https://nodejs.org/) 24 and [Docker](https://docs.docker.com/engine/install/) with Docker Compose v2.
2. Clone the repo:
   ```sh
   git clone https://github.com/bnonni/create-ln-app.git && cd create-ln-app
   ```
3. Install the dependencies:
   ```sh
   npm run install:all
   ```

## Folders

| Folder | Contents |
| --- | --- |
| `packages/create-ln-app/src/` | The CLI (`npx create-ln-app`). |
| `packages/create-ln-app/template/` | The project that the CLI copies. It is a standalone npm project, not a workspace member. |

## Checks

Run these commands from the repo root. CI runs the same commands on each push to `master` and on each pull request.

```sh
npm run lint        # oxlint, zero warnings allowed
npm run typecheck   # TypeScript, no emit
npm run build       # the CLI and the example app
```

The integration test uses the network. Run it in `packages/create-ln-app/template/`:

```sh
npm run network
npm run test:integration
npm run down
```

## Test the CLI

Run the CLI from the build:

```sh
npm run build -w create-ln-app
node packages/create-ln-app/dist/cli.js /tmp/test-app
```

Test the package that npm gets. Use a folder outside the repo, because the CLI does not run `git init` in a git repo. Replace `<version>` with the version in `packages/create-ln-app/package.json`.

```sh
mkdir -p /tmp/pack && rm -f /tmp/pack/*.tgz
npm pack -w create-ln-app --pack-destination /tmp/pack
cd /tmp && npx --yes --package /tmp/pack/create-ln-app-<version>.tgz create-ln-app test-app
cd test-app && npm run dev
```

## Publish

You must have publish rights for the `create-ln-app` package on npm.

1. In a pull request, set the version. The command also updates `package-lock.json`. Commit the two files.
   ```sh
   npm version <version> --no-git-tag-version -w create-ln-app
   ```
2. Merge the pull request. Make sure that CI is green on `master`.
3. Get `master`. Make sure that `git status` shows no changes.
4. Run the dry run. For a stable release, remove `--tag next`.
   ```sh
   npm publish --dry-run -w create-ln-app --tag next
   ```
5. Check the file list:
   - The list has `LICENSE`, `README.md`, `dist/cli.js`, and `package.json`. All other files are in `template/`.
   - The `template/` files are the same as the output of `git ls-files packages/create-ln-app/template`.
   - The list has no `.env`, no `node_modules`, and no node data. `template/network/data/.gitkeep` is the only file in `template/network/data/`.
6. Do the packed-tarball test in [Test the CLI](#test-the-cli).
7. Log in and publish:
   ```sh
   npm login
   npm publish -w create-ln-app --tag next
   ```
8. Tag the commit and push the tag:
   ```sh
   git tag -s v<version> -m "v<version>"
   git push origin v<version>
   ```
9. Check the tags on npm, then test the published package on a clean machine:
   ```sh
   npm view create-ln-app dist-tags
   npx create-ln-app@next my-lapp && cd my-lapp && npm run dev
   ```

### Tags

- `next`: a prerelease, for example `0.9.0`. You must use `--tag next`. If you do not, npm sets the `latest` tag, because `0.9.0` is not a semver prerelease version.
- `latest`: a stable release, for example `1.0.0`. Publish without `--tag`.

If a version has the wrong tag, move the tag:

```sh
npm dist-tag add create-ln-app@<version> <tag>
```
