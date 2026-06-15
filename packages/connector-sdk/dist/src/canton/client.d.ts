import { type SetupContext } from '@kaleido-io/workflow-engine-sdk';
import type { CantonContractEventsConfig } from './index.js';
/**
 * Client for the Kaleido Canton Connector. Provides helper methods for
 * setting up WFE streams backed by Canton contract event sources.
 */
export declare class CantonConnectorClient {
    private readonly bindingName;
    constructor(bindingName?: string);
    /**
     * Idempotently create or update a Canton contract events stream on the connector.
     *
     * Delegates to {@link ensureStream} from `@kaleido-io/workflow-engine-sdk`.
     */
    ensureStream(ctx: Pick<SetupContext, 'providerName' | 'handlerName' | 'getServiceClientOptions'>, opts: {
        factory: string;
        name: string;
        eventSourceConfig: CantonContractEventsConfig;
        description?: string;
    }): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map