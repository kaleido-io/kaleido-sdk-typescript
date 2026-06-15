import type { SetupContext } from '@kaleido-io/workflow-engine-sdk';
import type { EVMTransactionEventsConfig } from './stream-config.js';
/**
 * High-level client for managing EVM connector streams.
 *
 * Instantiate with the service binding name configured for your EVM connector
 * in the WFE client config, then call `ensureStream` from a handler's `setup`
 * hook to idempotently create or update a transaction event stream.
 */
export declare class EVMConnectorClient {
    private readonly connectorBindingName;
    constructor(bindingName?: string);
    /**
     * Idempotently create or update a WFE stream on the EVM connector.
     *
     * @param ctx - Setup context providing provider/handler identity and service client options.
     * @param opts - Stream factory, name, event source configuration, and optional description.
     */
    ensureStream(ctx: Pick<SetupContext, 'providerName' | 'handlerName' | 'getServiceClientOptions'>, opts: {
        factory: string;
        name: string;
        eventSourceConfig: EVMTransactionEventsConfig;
        description?: string;
    }): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map