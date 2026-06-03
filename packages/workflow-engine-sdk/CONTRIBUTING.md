# Contributing

## Testing Changes

### 1. Run the test suite

```bash
npm run test
```

Ensure all tests pass cleanly and all lines are covered.

### 2. Test a templated provider end-to-end

Build and pack the SDK from the repo root (so workspace packages are resolved):

```bash
# From repo root
npm run build:packages
npm pack --workspace packages/sdk
```

#### Testing locally (before submitting a PR)

Run `init` directly from the packed tarball. Set `WESDK_REPO_URL` to your local
checkout so the template clone never hits GitHub and picks up your uncommitted
changes:

```bash
TARBALL=$(ls packages/sdk/kaleido-io-sdk-*.tgz)
mkdir -p /tmp/ksdk-test && cd /tmp/ksdk-test
WESDK_REPO_URL="$OLDPWD" npx "file:$TARBALL" init my-provider --template getting-started
```

#### What SDK consumers run (once published to npm)

```bash
npx @kaleido-io/sdk init my-provider --template getting-started
```

The init script prompts you to choose a template when `--template` is omitted
and stdin is a TTY. Available templates: `getting-started`, `erc20-indexer`,
`btc-indexer`.

To test add-to-existing mode, create a minimal `package.json` first and omit
the project name:

```bash
mkdir -p /tmp/ksdk-add && cd /tmp/ksdk-add
echo '{"name":"my-project","version":"1.0.0","type":"module","dependencies":{}}' > package.json
WESDK_REPO_URL="$OLDPWD" npx "file:$TARBALL" init --template erc20-indexer
```

Edit the config files to point to a test environment, then:

```bash
cd /tmp/wesdk-test/my-provider
npm install
npm run start:dev
```

Verify the provider starts up cleanly. From here, carry out any feature testing as appropriate for the contribution.
