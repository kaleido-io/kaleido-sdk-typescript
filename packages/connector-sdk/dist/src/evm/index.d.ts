/**
 * TypeScript types for the event data produced by the `evmTransactions`
 * event source handler in the Kaleido EVM Connector.
 *
 * Import via:
 *   import type { EVMTransactionEvent } from '@kaleido-io/connector-sdk/evm';
 */
export type EVMTransactionEvent = {
    transactionHash: string;
    chainId: string;
    block: EVMBlockInfo;
    transaction?: EVMTransaction;
    receipt: EVMTransactionReceipt;
    decodedEvents?: EVMDecodedLogEvent[];
    decodedError?: EVMDecodedError;
    decodedInput?: EVMDecodedFunctionInput;
    ethTransfers?: EVMNativeETHTransfer[];
};
export type EVMBlockInfo = {
    number: string;
    hash: string;
    parentHash: string;
    timestamp: string;
    logsBloom: string;
    transactions: string[];
};
export type EVMTransaction = {
    blockHash: string;
    blockNumber: string;
    chainId: string;
    from: string;
    gas: string;
    gasPrice: string;
    hash: string;
    input: string;
    nonce: string;
    to: string;
    transactionIndex: string;
    type: string;
    value: string;
};
export type EVMTransactionReceipt = {
    transactionHash: string;
    transactionIndex: string;
    blockHash: string;
    blockNumber: string;
    from: string;
    to: string;
    cumulativeGasUsed: string;
    effectiveGasPrice: string;
    gasUsed: string;
};
export type EVMDecodedLogEvent = {
    logIndex: string;
    signature: string;
    solidityDef?: string;
    address: string;
    data: object;
};
export type EVMDecodedError = {
    signature: string;
    solidityDef: string;
    data: string;
};
export type EVMDecodedFunctionInput = {
    signature: string;
    solidityDef?: string;
    data: string;
};
export type EVMNativeETHTransfer = {
    from: string;
    to: string;
    value: string;
    /** Identifies the call in the nested trace stack; empty array for root-level transfers. */
    traceAddress?: number[];
};
export * from './stream-config.js';
export { EVMConnectorClient } from './client.js';
//# sourceMappingURL=index.d.ts.map