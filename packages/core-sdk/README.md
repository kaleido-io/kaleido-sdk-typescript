# @kaleido-io/core-sdk

Core utilities shared across the Kaleido TypeScript SDK family — HTTP transport, logging, service-binding resolution, and setup context.

## Installation

```bash
npm install @kaleido-io/core-sdk
```

## Entry points

The package exposes four entry points:

| Entry point | Contents |
|---|---|
| `@kaleido-io/core-sdk` | Service-binding config types, `resolveServiceBinding`, `resolveServiceBindingFromMap`, `SetupContext` |
| `@kaleido-io/core-sdk/http` | `HTTPTransport`, `WSProxyTransport`, `ServiceClient`, `createServiceTransport`, and related types |
| `@kaleido-io/core-sdk/log` | `Logger`, `LoggerFactory`, `newLogger`, `setLoggerFactory`, `defaultLoggerFactory` |
| `@kaleido-io/core-sdk/context` | `SetupContext`, `createSetupContext` |

## Logging

Use `newLogger` to create a named logger and `setLoggerFactory` to plug in your own logging library at application startup:

```ts
import { newLogger, setLoggerFactory } from '@kaleido-io/core-sdk';

// Optional: replace the built-in console logger
setLoggerFactory((context) => myLogger.child({ context }));

const log = newLogger('my-handler');
log.info('Starting up');
```

Loggers are late-binding proxies — a `setLoggerFactory` call takes effect even for loggers already created before it.

## Service bindings

Use `resolveServiceBinding` to build `ServiceClientOptions` from a Kaleido YAML config file, or `resolveServiceBindingFromMap` to resolve from a parsed config map:

```ts
import { resolveServiceBinding } from '@kaleido-io/core-sdk';
import { AssetManagerClient } from '@kaleido-io/asset-manager-sdk';

const client = new AssetManagerClient(resolveServiceBinding('asset-manager'));
```

## HTTP transport

`createServiceTransport` builds an `HTTPTransport` or `WSProxyTransport` from `ServiceClientOptions`. This is primarily used by the typed service clients (`AssetManagerClient`, etc.) internally. You can also use `configureHttpClient` to apply shared Axios defaults:

```ts
import { configureHttpClient } from '@kaleido-io/core-sdk/http';

configureHttpClient({ timeout: 10_000 });
```

## License

Apache-2.0
