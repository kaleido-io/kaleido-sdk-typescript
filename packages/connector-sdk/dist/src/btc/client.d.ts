import type { SetupContext } from '@kaleido-io/workflow-engine-sdk';
import type { BTCTransactionEventsConfig } from './stream-config.js';
/**
 * Helper client for setting up streams on the Kaleido BTC Connector.
 * Wraps ensureStream with the connector binding name so callers do not need
 * to repeat it at every call site.
 */
export declare class BTCConnectorClient {
    private readonly bindingName;
    constructor(bindingName?: string);
    /**
     * Idempotently create or update a transactionEvents stream on the BTC Connector.
     *
     * @param ctx - The handler setup context providing provider identity and service client options.
     * @param opts - Stream factory name, unique stream name, event source config, and optional description.
     */
    ensureStream(ctx: Pick<SetupContext, 'providerName' | 'handlerName' | 'getServiceClientOptions'>, opts: {
        factory: string;
        name: string;
        eventSourceConfig: BTCTransactionEventsConfig;
        description?: string;
    }): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map