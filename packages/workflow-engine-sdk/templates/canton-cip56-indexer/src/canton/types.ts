/**
 * TypeScript types matching the Go structs emitted by the Canton connector.
 *
 * Go source: cantonconnect/pkg/cantontypes/event_types.go
 *            cantonconnect/pkg/cantontypes/contract_types.go
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

/**
 * Stream configuration accepted by the cantonContractEvents event source.
 */
export type CantonContractEventsConfig = {
  fromOffset?: number | null;
  fromCurrentOffset?: boolean;
  pollTimeout?: string | null;
  batchSize?: number | null;
  parties?: string[];
  templateIds?: string[];
  interfaceIds?: string[];
  includeCreatedEventBlob?: boolean | null;
  userId?: string;
};
