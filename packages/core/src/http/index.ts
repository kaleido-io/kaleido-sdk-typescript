// Transport interface
export { ServiceTransport } from "./transport";

// Transport implementations
export { HTTPTransport, HTTPTransportOptions } from "./http_base";
export {
  WSProxyTransport,
  WSProxyTransportOptions,
  WSProxyServiceClient,
  IWSProxy,
  WSProxyResponse,
} from "./ws_proxy_transport";

// ServiceClient base class + factory
export {
  ServiceClient,
  ServiceClientOptions,
  createServiceTransport,
} from "./service_client";

// Auth and logging types
export { Logger, ServiceBindingAuth } from "./types";

// HTTP client configuration
export {
  configureHttpClient,
  HttpClientOptions,
  RetryConfig,
  RequestConfigWithRetry,
} from "./http_client";
