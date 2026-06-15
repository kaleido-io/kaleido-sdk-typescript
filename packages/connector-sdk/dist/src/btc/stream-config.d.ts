/**
 * Configuration for the `transactionEvents` event source on the Kaleido BTC Connector.
 * All fields are optional. Pass this as `eventSourceConfig` when calling ensureStream.
 */
export type BTCTransactionEventsConfig = {
    /** Starting block for event delivery. */
    fromBlock?: string;
    /** Target number of events per batch. */
    batchSize?: number;
    /** Maximum duration to wait for a batch to fill before flushing (duration string, e.g. "5s"). */
    batchTimeout?: string;
    /** Maximum duration to wait for new events before updating the checkpoint (duration string). */
    pollTimeout?: string;
    /** Number of block confirmations required before an event is delivered. */
    requiredConfirmations?: number;
    /** Must be true when no address or other filters are specified. */
    unfiltered?: boolean;
    /** Number of blocks to fetch per page during catch-up. */
    catchupPageSize?: number;
    /** Soft limit on the number of UTXOs included in a single batch (BTC-specific). */
    batchUTXOSoftLimit?: number;
};
//# sourceMappingURL=stream-config.d.ts.map