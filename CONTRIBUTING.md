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
4. Start the network, the API server, and the example app of the template:
   ```sh
   npm run dev
   ```

## Folders

| Folder | Contents |
| --- | --- |
| `packages/create-ln-app/src/` | The CLI (`npx create-ln-app`). |
| `packages/create-ln-app/template/` | The project that the CLI copies for `--template react-ts` (the default). It is a standalone npm project, not a workspace member. |
| `packages/create-ln-app/template-react/` | The project that the CLI copies for `--template react`. The generator makes it from `template/`. Git ignores it. |
| `packages/create-ln-app/scripts/` | The generator of the JavaScript template. |
| `e2e/` | The Playwright test of the browser steps. |

### The JavaScript template

Make all changes in `template/`. Do not edit `template-react/`, because the generator deletes it and makes it again. `npm pack` and `npm publish` run the generator before the build. To make the folder yourself, run this command from the repo root:

```sh
npm run js-template -w create-ln-app
```

The generator removes the types and formats the result. If the generator cannot find a string that it changes, it stops and shows the file. Then update `scripts/js-template.ts`. To lint the JavaScript template, copy it to a folder outside the repo first, because oxlint skips the files that git ignores.

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

The E2E test does the browser steps of the example app in Chromium. It starts the API server and Vite. If they already run, the test uses them. The network must run first.

1. Install the browser one time (about 130 MB):
   ```sh
   npx playwright install --only-shell chromium
   ```
2. Start the network in `packages/create-ln-app/template/`:
   ```sh
   npm run network
   ```
3. Run the test from the repo root:
   ```sh
   npm run test:e2e
   ```

To test a project that the CLI made, set `LAPP_DIR` to the project folder, for example `LAPP_DIR=/tmp/test-app npm run test:e2e`. CI packs the CLI, makes a project, and runs the test on it. The E2E jobs test 3 LND nodes, 5 LND nodes, 3 CLN nodes, 3 Eclair nodes, a mix of the 3 impls, and the `react` template. The mix job also runs the integration test for each node pair. The `react` job also makes sure that the project has no TypeScript file, then lints and builds it. If the test fails in CI, the job shows the network logs and uploads the Playwright traces.

## Test the CLI

Run the CLI from the build:

```sh
npm run build -w create-ln-app
node packages/create-ln-app/dist/cli.js /tmp/test-app
```

To test the JavaScript template, make it first:

```sh
npm run js-template -w create-ln-app
node packages/create-ln-app/dist/cli.js /tmp/test-js-app --template react
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

1. In a pull request, set the version. The command also updates `package-lock.json`.
   ```sh
   npm version <version> --no-git-tag-version -w create-ln-app
   ```
   Add a section for the version to `CHANGELOG.md`. Commit the three files.
2. Merge the pull request. Make sure that CI is green on `master`.
3. Get `master`. Make sure that `git status` shows no changes.
4. Run the dry run. For a stable release, remove `--tag next`.
   ```sh
   npm publish --dry-run -w create-ln-app --tag next
   ```
5. Check the file list:
   - The list has `LICENSE`, `README.md`, `dist/cli.js`, `dist/copy-filter.js`, and `package.json`. All other files are in `template/` and `template-react/`.
   - The `template/` files are the same as the output of `git ls-files packages/create-ln-app/template`.
   - The `template-react/` files have no `.ts` file, no `.tsx` file, and no `tsconfig` file.
   - The list has no `.env`, no `node_modules`, and no node data. In each template, `network/data/.gitkeep` is the only file in `network/data/`.
6. Do the packed-tarball test in [Test the CLI](#test-the-cli).
7. Log in and publish. For a stable release, remove `--tag next`.
   ```sh
   npm login
   npm publish -w create-ln-app --tag next
   ```
8. Tag the commit and push the tag:
   ```sh
   git tag -s v<version> -m "v<version>"
   git push origin v<version>
   ```
9. Check the tags on npm, then test the published package on a clean machine. For a stable release, remove `@next`.
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
