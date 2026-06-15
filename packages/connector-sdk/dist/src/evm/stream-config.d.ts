/**
 * Address and event signature filter for EVM log subscriptions.
 * Multiple filters are combined with OR logic.
 */
export type EVMLogFilter = {
    addresses?: string[];
    eventSignatures?: string[];
    events?: unknown[];
};
/**
 * Configuration for the `transactionEvents` stream factory in the Kaleido EVM Connector.
 * All fields are optional; populate only the fields relevant to your stream.
 *
 * Pass an instance of this type as `eventSourceConfig` when calling `ensureStream`.
 */
export type EVMTransactionEventsConfig = {
    /** ABI JSON array used to decode logs, function inputs, and errors. */
    abi?: unknown[] | null;
    /** Starting block for the stream: 'latest', 'earliest', or a decimal block number string. */
    fromBlock?: string | null;
    /** Target number of events per delivered batch. */
    batchSize?: number | null;
    /** Maximum duration to wait before delivering a partially-filled batch (e.g. '5s'). */
    batchTimeout?: string | null;
    /** Maximum duration to wait for new events before updating the checkpoint (e.g. '30s'). */
    pollTimeout?: string | null;
    /** Number of block confirmations required before an event is delivered. */
    requiredConfirmations?: number | null;
    /**
     * Must be set to true when no logFilters are specified, to signal intentional
     * subscription to all events.
     */
    unfiltered?: boolean | null;
    /** Address and event signature filters applied to log subscriptions (OR-combined). */
    logFilters?: EVMLogFilter[] | null;
    /** Enable trace_block calls to capture native ETH transfers. */
    enableBlockTrace?: boolean | null;
    /** Controls which events are delivered: all, only decoded, or filtered to decoded only. */
    eventMode?: 'all' | 'require_decoded' | 'filter_decoded' | null;
    /** Number of blocks to retrieve per page during catch-up processing. */
    catchupPageSize?: number | null;
    /** Number of blocks to fetch ahead of the current position during catch-up. */
    catchupBlockFetchAhead?: number | null;
    /** Include decoded transaction input data in delivered events. */
    includeInputs?: boolean | null;
    /** Include raw binary transaction input in delivered events. */
    includeBinaryInput?: boolean | null;
    /** Include raw binary log data in delivered events. */
    includeBinaryLogs?: boolean | null;
    /** Omit the Solidity definition string from decoded event and function objects. */
    omitSolidityDef?: boolean | null;
    /** Output format specifier for event data serialisation. */
    outputFormat?: string | null;
};
//# sourceMappingURL=stream-config.d.ts.map