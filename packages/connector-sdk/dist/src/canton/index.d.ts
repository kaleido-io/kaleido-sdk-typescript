/**
 * TypeScript types for the event data produced by the `cantonContractEvents`
 * event source handler in the Kaleido Canton Connector.
 *
 * Import via:
 *   import type { CantonContractEvent } from '@kaleido-io/connector-sdk/canton';
 */
export type CantonContractEvent = {
    eventType: 'created' | 'archived' | 'exercised';
    contractId: string;
    templateId: string;
    packageId: string;
    packageName?: string;
    moduleName: string;
    entityName: string;
    arguments?: Record<string, unknown> | null;
    choice?: string;
    consuming?: boolean;
    offset: number;
    transactionId: string;
    workflowId: string;
    effectiveAt?: string | null;
    updateId: string;
    completionOffset: string;
    createdEventBlob?: string;
    synchronizerId?: string;
    signatories?: string[];
    observers?: string[];
    interfaceViews?: ContractInterfaceView[];
};
export type ContractInterfaceView = {
    interfaceId: string;
    packageId: string;
    packageName?: string;
    moduleName: string;
    entityName: string;
    viewValue?: Record<string, unknown> | null;
};
export type CantonContractEventsFilters = {
    /** Parties to listen for. Specify ALL parties involved in your contracts for complete archive tracking. */
    parties?: string[];
    /** Template IDs to filter on. Format: #PackageName:Module:Entity */
    templateIds?: string[];
    /** Interface IDs to filter on. Format: #PackageName:Module:Entity */
    interfaceIds?: string[];
};
export type CantonContractEventsStream = {
    /** Maximum time to wait for events before returning to update the checkpoint (e.g. '5s'). */
    pollTimeout?: string | null;
    /** Maximum events per batch dispatched to the event processor. */
    batchSize?: number | null;
    /** Internal channel buffer size for the background stream listener. */
    channelBufferSize?: number | null;
};
export type CantonContractEventsConfig = {
    fromOffset?: number | null;
    fromCurrentOffset?: boolean;
    includeCreatedEventBlob?: boolean | null;
    userId?: string;
    filters?: CantonContractEventsFilters;
    stream?: CantonContractEventsStream;
};
export declare const HOLDING_INTERFACE = "Splice.Api.Token.HoldingV1:Holding";
export declare const TRANSFER_INSTRUCTION_INTERFACE = "Splice.Api.Token.TransferInstructionV1:TransferInstruction";
export type HoldingView = {
    owner: string;
    amount: string;
    instrumentId?: {
        admin?: string;
        id?: string;
    };
    lock?: unknown;
    meta?: {
        values?: Record<string, string>;
    };
};
export type TransferData = {
    sender: string;
    receiver: string;
    amount: string;
    instrumentId?: {
        admin?: string;
        id?: string;
    };
};
export { CantonConnectorClient } from './client.js';
//# sourceMappingURL=index.d.ts.map