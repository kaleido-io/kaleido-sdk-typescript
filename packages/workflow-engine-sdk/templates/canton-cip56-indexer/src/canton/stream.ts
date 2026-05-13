import provider from '../provider.js';
import { loadProviderConfig } from '../config/provider-config.js';
import type { CantonContractEventsConfig } from './types.js';

const providerConfig = loadProviderConfig();

const eventSourceConfig: CantonContractEventsConfig = {
  fromOffset: 0,
  batchSize: 100,
  pollTimeout: '5s',
  parties: [],
  interfaceIds: [
    '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
    '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
  ],
  includeCreatedEventBlob: false,
};

/**
 * WFE event stream definition for the Canton CIP-56 indexer.
 *
 * Connects two handlers:
 *   Source:    "cantonContractEvents" from the Canton Connector — polls for
 *             contract lifecycle events matching CIP-56 interface IDs.
 *   Processor: "canton-cip56-indexer" from this provider — maps contract events
 *             into Asset Manager bulk upserts.
 *
 * Deploy with: npm run create-stream
 */
export const stream = {
  name: 'canton-cip56-indexer',
  eventSource: {
    type: 'handler',
    handler: {
      name: 'cantonContractEvents',
      provider: providerConfig.canton?.cantonConnector ?? '',
      config: eventSourceConfig,
    },
  },
  eventProcessor: {
    type: 'handler',
    handler: {
      name: 'canton-cip56-indexer',
      provider: provider.name,
    },
  },
};
