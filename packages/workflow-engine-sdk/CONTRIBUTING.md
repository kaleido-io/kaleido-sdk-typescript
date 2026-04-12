# Contributing

## Testing Changes

### 1. Run the test suite

```bash
npm run test
```

Ensure all tests pass cleanly and all lines are covered.

### 2. Test a templated provider end-to-end

Build and pack the SDK:

```bash
npm pack
mv kaleido-io-workflow-engine-sdk-<version>.tgz ~/Desktop
```

Create a fresh provider from the pack:

```bash
cd ~/Desktop
npm uninstall @kaleido-io/workflow-engine-sdk
npm i ./kaleido-io-workflow-engine-sdk-<version>.tgz
npx @kaleido-io/workflow-engine-sdk init my-provider --template getting-started
```

Link your local SDK and run:

```bash
cd my-provider
npm link @kaleido-io/workflow-engine-sdk
```

Edit the config files to point to a test environment, then:

```bash
npm run start:dev
```

Verify the provider starts up cleanly. From here, carry out any feature testing as appropriate for the contribution.
