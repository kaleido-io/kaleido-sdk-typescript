# Service Package

## Purpose

This package provides an opinionated, production-quality service client layer for provider code that talks to platform services. It solves a specific problem: **every provider that makes outbound service calls ends up reimplementing the same boilerplate** — connection pooling, DNS caching, retry with backoff, auth headers — and doing it inconsistently.

It is also **transport-agnostic**: the same typed client code works whether the provider runs externally (direct HTTP) or on a hosted platform (HTTP-over-WebSocket via provider-proxy). The transport is resolved at construction time from the service binding config.

This is a **framework-agnostic port** of `@kaleido-io/kaleido-studio-nest-base/http`. The original depends on NestJS; this version has zero framework dependencies and is designed to work inside the workflow engine SDK.

## Architecture

```
Layer 3:  Typed Service SDK      amClient.bulkUpsert(payload)
Layer 2:  ServiceClient base     this.put('/api/v1/bulk/datamodel', payload)
Layer 1:  ServiceTransport       HTTPTransport (Axios) | WSProxyTransport (WS proxy)
```

Handler code interacts with Layer 3 (typed methods). `ServiceClient` handles Layer 2 (method delegation). Layer 1 (how the request actually travels) is resolved transparently from the `ServiceClientOptions` discriminated union.

## What It Does

### Connection Pooling (KeepAlive) — HTTP transport only

Node.js defaults to creating a new TCP connection for every HTTP request. Under load, this causes TCP handshake overhead, socket exhaustion, and repeated TLS negotiation cost.

`HTTPTransport` creates `http.Agent` and `https.Agent` with `keepAlive: true`, capped at 50 max sockets and 10 max free sockets. Connections are reused across requests to the same host.

### DNS Caching — HTTP transport only

Node.js makes a `getaddrinfo` syscall for every DNS lookup by default. This is expensive under load and can cause intermittent failures depending on the OS resolver.

`configureHttpClient` installs `cacheable-lookup` on both agents, which caches DNS responses in-process and respects TTL from DNS records.

### Smart Retry with Exponential Backoff — HTTP transport only

Not all requests should be retried, and not all methods are safe to retry:

| Method | Retry on 5xx | Retry on network error | Retry on 429 |
|--------|-------------|----------------------|--------------|
| GET, HEAD, OPTIONS, PUT, DELETE (idempotent) | Yes | Yes | Yes |
| POST, PATCH (non-idempotent) | No | Yes | Yes |

POST and PATCH are not retried on 5xx because the server may have partially processed the request. They are retried on network errors (where no response was received) and on 429 (rate limiting is safe to retry).

Retry uses `axios-retry` with exponential backoff and resets the timeout on each attempt.

Individual requests can override the retry behavior via `RetryConfig`:

```typescript
await client.post('/api/v1/transactions', data, {
  retry: false,              // disable retry entirely
  retryOn5xx: true,          // force retry on 5xx even for POST
  retryOnRateLimit: false,   // don't retry on 429
});
```

### Auth Header Injection — HTTP transport only

Credentials are configured once at construction time and applied to every request. Supports `ServiceBindingAuth` with two modes:

- **Basic auth** — `Authorization: Basic base64(username:password)`
- **Token auth** — configurable header name (default `Authorization`) with optional scheme prefix (e.g. `Bearer`)

### WebSocket Proxy Transport — hosted mode

For platform-hosted providers, requests are serialized as `ServiceProxyRequest` messages and sent over a WebSocket to the provider-proxy service. The proxy executes the HTTP request and returns a `ServiceProxyResponse`. Auth is managed by the proxy, not the SDK.

## The Files

### `types.ts` — `ServiceBindingAuth`, `ServiceBindingConfig`, `ServiceBindingsMap`, `ProviderProxyConfig`

Type definitions for service binding configuration. `ServiceBindingConfig` now has a `bindingType` discriminator:

```typescript
// Non-hosted (direct HTTP) binding
const config: ServiceBindingConfig = {
  type: 'asset-manager',
  bindingType: 'non-hosted',   // default
  url: 'https://my-service/api',
  auth: { type: 'basic', username: 'my-key', password: 'my-secret' },
};

// Hosted (proxied) binding
const config: ServiceBindingConfig = {
  type: 'asset-manager',
  bindingType: 'hosted',
  id: 'instance-uuid',   // resolved by the proxy to the actual service URL
};
```

`ServiceBindingAuth` supports two modes:

```typescript
const auth: ServiceBindingAuth = {
  type: 'basic',
  username: 'my-key',
  password: 'my-secret',
};

const auth: ServiceBindingAuth = {
  type: 'token',
  token: 'eyJ...',
  scheme: 'Bearer',        // optional, prefixed to token
  header: 'Authorization', // optional, defaults to Authorization
};
```

`ProviderProxyConfig` holds the WebSocket URL for the provider-proxy connection.

### `transport.ts` — `ServiceTransport`

Transport-agnostic interface for HTTP-style service communication. Implemented by `HTTPTransport` and `WSProxyTransport`. Consumers never implement this interface directly — it is resolved internally by `ServiceClient`.

### `service_client.ts` — `ServiceClient`, `ServiceClientOptions`, `createServiceTransport()`

The main entry point for typed service clients.

`ServiceClientOptions` is a discriminated union that selects the transport:

```typescript
type ServiceClientOptions =
  | ({ transport: 'http' } & HTTPTransportOptions)
  | ({ transport: 'ws-proxy' } & WSProxyTransportOptions);
```

`ServiceClient` is the abstract base class that typed clients extend:

```typescript
class AssetManagerClient extends ServiceClient {
  constructor(options: ServiceClientOptions) {
    super(createServiceTransport(options));
  }

  async bulkUpsert(input: BulkUpsertInput): Promise<BulkUpsertResult> {
    return this.put<BulkUpsertResult>('/api/v1/bulk/datamodel', input);
  }

  async getFragmentsByNames(names: string[]): Promise<Fragment[]> {
    const resp = await this.post<{ fragments?: { items?: Fragment[] } }>(
      '/api/v1/bulk/query',
      { fragments: { in: [{ field: 'name', values: names }], limit: names.length } },
    );
    return resp?.fragments?.items ?? [];
  }
}
```

Construction from a service binding is one line:

```typescript
const options = client.getServiceClientOptions('asset-manager');
const amClient = new AssetManagerClient(options);
```

Protected methods available in `ServiceClient`:
- `this.get<T>(url, params?, config?)` — supports `{ ignore404: true }` to return `undefined` instead of throwing
- `this.post<T>(url, data, config?)`
- `this.put<T>(url, data, config?)`
- `this.patch<T>(url, data, config?)`
- `this.delete(url, params?, config?)`

All methods unwrap `response.data` (HTTP) or decode `bodyBase64` (WS proxy) so typed clients return domain objects directly.

### `http_base.ts` — `HTTPTransport`

Direct HTTP transport via Axios. Self-contained: the constructor creates and configures the Axios instance via `configureHttpClient()` in a single step. Implements `ServiceTransport`.

```typescript
const transport = new HTTPTransport({
  url: 'https://my-service/api',
  auth: { type: 'basic', username: 'u', password: 'p' },
  maxRetries: 3,
  timeout: 30000,
});
```

Exposes `getHttpInstance()` for advanced use cases requiring direct Axios access.

### `http_client.ts` — `configureHttpClient()`

A standalone function that enhances any Axios instance. Use this when you already have an Axios instance and want to add production features. Used internally by `HTTPTransport`.

```typescript
import axios from 'axios';
import { configureHttpClient } from '@kaleido-io/workflow-engine-sdk';

const instance = axios.create({ baseURL: 'https://my-service/api' });
configureHttpClient(instance, {
  auth: { type: 'basic', username: 'u', password: 'p' },
  maxRetries: 3,
  timeout: 30000,
});
```

### `ws_proxy_adapter.ts` — `WSProxyAdapter`

Low-level WebSocket adapter that manages the connection to the provider-proxy service. Sends `ServiceProxyRequest` messages and correlates `ServiceProxyResponse` messages by `requestId`.

Two connection modes:
- **Dedicated proxy connection** — when `url` is configured, the adapter manages its own WebSocket. Used in hosted mode.
- **Handler runtime fallback** — when no URL, sends through the handler runtime's existing WS connection (future: WFE-native proxy).

```typescript
const adapter = new WSProxyAdapter({ url: 'ws://provider-proxy:8080', requestTimeoutMs: 60000 });
await adapter.connect();
// ...
adapter.disconnect();
```

### `ws_proxy_service_client.ts` — `WSProxyTransport`

WebSocket proxy transport. Serializes HTTP-style calls as `ServiceProxyRequest` messages, sends them through `WSProxyAdapter`, and decodes responses. Implements `ServiceTransport`. Used for hosted provider mode.

## What Changed from the nest-base Original

| Aspect | nest-base (`kaleido-studio-nest-base/http`) | SDK port (`src/service/`) |
|--------|---------------------------------------------|--------------------------|
| Framework dependency | `@nestjs/common` (Logger) | None — uses SDK's own logger |
| Auth model | `BasicAuth \| OAuthTokenInfo` (duck-typed) | `ServiceBindingAuth` (discriminated union with `type` field) |
| OAuth refresh | Request interceptor with `OAuthRefreshHandler` | Not supported (not needed for service bindings) |
| Basic auth application | `instance.defaults.auth` (Axios built-in) | Manual `Authorization: Basic ...` header |
| Token auth | Bearer only, hardcoded header | Configurable header name + scheme prefix |
| Base class for typed clients | `HTTPBase` extends class | `ServiceClient` abstract class (transport-agnostic) |
| Transport selection | HTTP only | `ServiceClientOptions` discriminated union: `http` or `ws-proxy` |
| Hosted mode | Not supported | `WSProxyTransport` via `WSProxyAdapter` |
| `HTTPBase` options | `url` + `requestConfig` only | `HTTPTransportOptions` adds `auth`, `maxRetries`, `timeout`, `rejectUnauthorized` |
| Retry/pooling/DNS logic | Identical | Identical |
