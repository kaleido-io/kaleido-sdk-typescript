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
npm pack --workspace packages/samples-sdk
```

#### Testing locally (before submitting a PR)

Run `init` directly from the packed tarball. Set `KSDK_REPO_URL` to your local
checkout so the template clone never hits GitHub and picks up your uncommitted
changes:

```bash
TARBALL=$(ls packages/samples-sdk/kaleido-io-samples-sdk-*.tgz)
mkdir -p /tmp/ksdk-test && cd /tmp/ksdk-test
KSDK_REPO_URL="$OLDPWD" npx "file:$TARBALL" init my-provider --template workflow-engine-provider
```

#### What SDK consumers run (once published to npm)

```bash
npx @kaleido-io/samples-sdk init my-provider --template workflow-engine-provider
```

The init script prompts you to choose a template when `--template` is omitted
and stdin is a TTY. Available templates: `workflow-engine-provider`, `erc20-indexer`,
`btc-indexer`.

To test add-to-existing mode, create a minimal `package.json` first and omit
the project name:

```bash
mkdir -p /tmp/ksdk-add && cd /tmp/ksdk-add
echo '{"name":"my-project","version":"1.0.0","type":"module","dependencies":{}}' > package.json
KSDK_REPO_URL="$OLDPWD" npx "file:$TARBALL" init --template erc20-indexer
```

Edit the config files to point to a test environment, then:

```bash
cd /tmp/wesdk-test/my-provider
npm install
npm run start:dev
```

Verify the provider starts up cleanly. From here, carry out any feature testing as appropriate for the contribution.
