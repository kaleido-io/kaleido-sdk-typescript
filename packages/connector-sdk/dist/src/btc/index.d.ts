/**
 * TypeScript types for the event data produced by the `btcTransactions`
 * event source handler in the Kaleido EVM Connector.
 *
 * Import via:
 *   import type { BTCTransactionEvent } from '@kaleido-io/connector-sdk/btc';
 */
export type BlockIdentity = {
    height: number;
    hash: string;
    previousblockhash?: string;
};
export type TxSummaryScriptSig = {
    hex: string;
    type?: string;
    address?: string;
};
export type TxSummaryVIn = {
    txid: string;
    vout: number;
    value?: number;
    valueSat?: number;
    scriptSig: TxSummaryScriptSig;
    txinwitness?: string[];
    sequence: number;
};
export type TxSummaryScriptPubKey = {
    hex: string;
    address?: string;
    type: string;
};
export type TxSummaryVOut = {
    value?: number;
    valueSat?: number;
    n: number;
    scriptPubKey?: TxSummaryScriptPubKey;
    redeemScript?: string;
};
export type TxSummary = {
    txid: string;
    hash: string;
    version: number;
    size?: number;
    vsize?: number;
    weight?: number;
    locktime: number;
    vin: TxSummaryVIn[];
    vout: TxSummaryVOut[];
};
export type NetworkInfo = {
    name: string;
    net: number;
};
export type BTCTransactionEvent = {
    network: NetworkInfo;
    block: BlockIdentity;
    tx: TxSummary;
};
export * from './stream-config.js';
export { BTCConnectorClient } from './client.js';
//# sourceMappingURL=index.d.ts.map