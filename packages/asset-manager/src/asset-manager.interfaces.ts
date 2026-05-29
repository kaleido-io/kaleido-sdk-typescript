// ============================================================================
// Helper Types
// ============================================================================

export interface KldResourceBase {
  id: string;
  created?: string;
  updated?: string;
}

export interface NameAndID {
  name: string;
  id?: string;
  parent?: DataModelReference;
}

export type DataModelReference = string;

export interface ObjectLabels {
  labels?: Record<string, string>;
}

export interface AddressScope {
  address?: string;
}

export interface ItemsResult<T> {
  count: number;
  total?: number;
  items: T[];
}

export type UpdateType =
  | "create_only"
  | "update_only"
  | "create_or_replace"
  | "create_or_update"
  | "create_or_ignore";

// ============================================================================
// Data Model
// ============================================================================

// Assets
export interface AssetInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  collection?: DataModelReference;
}

export interface Asset extends KldResourceBase, AssetInput, ObjectLabels {
  name: string;
}

// Addresses
export interface AddressInput {
  address?: string;
  displayName?: string;
  description?: string;
  info?: any;
  contract?: boolean;
  contractManager?: {
    service?: string;
    build?: string;
  };
  firefly?: {
    namespace?: string;
    api?: string;
  };
}

export interface Address extends AddressInput, ObjectLabels {
  address: string;
  created?: string;
  updated?: string;
}

// Pools
export interface PoolInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  standard?: string;
  firefly?: {
    namespace?: string;
    api?: string;
  };
  asset?: DataModelReference;
  address?: string;
}

export interface Pool extends KldResourceBase, PoolInput, ObjectLabels {
  name: string;
  qualifiedName?: string;
}

// Collections
export interface CollectionInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
}

export interface Collection
  extends KldResourceBase, CollectionInput, ObjectLabels {
  name: string;
}

// Activities
export interface ActivityInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
}

export interface Activity extends KldResourceBase, ActivityInput, ObjectLabels {
  name: string;
}

// Data
export type DataParentType =
  | "none"
  | "address"
  | "asset"
  | "collection"
  | "nft"
  | "pool"
  | "fragment";

export interface DataParent {
  type?: DataParentType;
  ref?: DataModelReference;
}

export interface DataFFLinks {
  namespace?: string;
  data?: string;
}

export interface DataInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  uri?: string;
  transactionHash?: string;
  role?: string;
  firefly?: DataFFLinks;
  parent?: DataParent;
}

export interface Data extends KldResourceBase, DataInput, ObjectLabels {
  name: string;
  asset?: DataModelReference;
}

// Activity Events
export type EventParentType =
  | "none"
  | "address"
  | "asset"
  | "collection"
  | "nft"
  | "pool"
  | "fragment"
  | "data";

export interface EventParent {
  type?: EventParentType;
  ref?: DataModelReference;
}

export interface EventInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  parent?: EventParent;
}

export interface ActivityEvent
  extends KldResourceBase, EventInput, ObjectLabels {
  name: string;
  topic?: string;
  sequence?: number;
  activity?: DataModelReference;
  asset?: DataModelReference;
}

// Fragments
export interface FragmentInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  value?: string;
  valueMasked?: boolean;
  valueReference?: string;
  asset?: DataModelReference;
}

export interface Fragment
  extends KldResourceBase, FragmentInput, ObjectLabels, AddressScope {
  name: string;
  qualifiedName?: string;
}

// NFTs
export interface NFTFFLinks {
  namespace?: string;
}

export interface NFTInput {
  name?: string;
  displayName?: string;
  description?: string;
  info?: any;
  standard?: string;
  tokenIndex?: string;
  uri?: string;
  active?: boolean;
  firefly?: NFTFFLinks;
  asset?: DataModelReference;
}

export interface NFT
  extends KldResourceBase, NFTInput, ObjectLabels, AddressScope {
  name: string;
  qualifiedName?: string;
}

// Transfers
export interface TransferFFLinks {
  namespace?: string;
  blockchainEvent?: string;
}

export type TransferParentType = "nft" | "pool";

export interface TransferParent {
  type?: TransferParentType;
  ref?: DataModelReference;
}

export type TransferType = "mint" | "burn" | "transfer";

export interface TransferInput {
  protocolId: string;
  displayName?: string;
  description?: string;
  info?: any;
  type?: TransferType;
  signer?: string;
  from?: string;
  to?: string;
  amount?: string;
  firefly?: TransferFFLinks;
  transactionHash: string;
  balanceChanges?: BalanceChangeInput[];
}

export interface Transfer extends KldResourceBase, TransferInput, ObjectLabels {
  asset?: DataModelReference;
  parent?: TransferParent;
}

// Balance Changes
export type BalanceTransferOp = "add" | "subtract";

export interface BalanceChangeInput {
  address?: string;
  operation?: BalanceTransferOp;
  amount?: string;
}

export interface BalanceChange extends KldResourceBase, BalanceChangeInput {
  asset?: DataModelReference;
  parent?: TransferParent;
  transfer?: string;
  name?: string;
  balanceBefore?: string;
  balanceAfter?: string;
}

// Balances
export interface Balance {
  id: string;
  address?: string;
  asset?: string;
  pool?: string;
  balanceAfter?: string;
  updated?: string;
}

// ============================================================================
// Bulk Data Types
// ============================================================================

export type SimpleFilterValue = string;

export interface FilterJSONBase {
  not?: boolean;
  caseInsensitive?: boolean;
  field?: string;
}

export interface FilterJSONKeyValue extends FilterJSONBase {
  value?: SimpleFilterValue;
}

export interface FilterJSONKeyValues extends FilterJSONBase {
  values?: SimpleFilterValue[];
}

export interface FilterJSONOps {
  equal?: FilterJSONKeyValue[];
  eq?: FilterJSONKeyValue[];
  neq?: FilterJSONKeyValue[];
  contains?: FilterJSONKeyValue[];
  startsWith?: FilterJSONKeyValue[];
  endsWith?: FilterJSONKeyValue[];
  lessThan?: FilterJSONKeyValue[];
  lt?: FilterJSONKeyValue[];
  lessThanOrEqual?: FilterJSONKeyValue[];
  lte?: FilterJSONKeyValue[];
  greaterThan?: FilterJSONKeyValue[];
  gt?: FilterJSONKeyValue[];
  greaterThanOrEqual?: FilterJSONKeyValue[];
  gte?: FilterJSONKeyValue[];
  in?: FilterJSONKeyValues[];
  nin?: FilterJSONKeyValues[];
  null?: FilterJSONBase[];
}

export interface FilterJSON extends FilterJSONOps {
  or?: FilterJSON[];
}

export interface QueryJSON extends FilterJSON {
  skip?: number;
  limit?: number;
  sort?: string[];
  count?: boolean;
  fields?: string[];
}

export interface DataModelQueryJSON extends QueryJSON {
  labels?: FilterJSONOps;
}

export interface FilterResult<T> {
  count: number;
  total?: number;
  allItems: boolean;
  context?: {
    query?: string;
  };
  items: T[];
}

export interface BulkQueryInput {
  activities?: DataModelQueryJSON;
  addresses?: DataModelQueryJSON;
  assets?: DataModelQueryJSON;
  collections?: DataModelQueryJSON;
  data?: DataModelQueryJSON;
  events?: DataModelQueryJSON;
  fragments?: DataModelQueryJSON;
  nfts?: DataModelQueryJSON;
  pools?: DataModelQueryJSON;
  transfers?: DataModelQueryJSON;
  balanceChanges?: DataModelQueryJSON;
}

export interface BulkQueryOutput {
  activities?: FilterResult<Activity>;
  addresses?: FilterResult<Address>;
  assets?: FilterResult<Asset>;
  collections?: FilterResult<Collection>;
  data?: FilterResult<Data>;
  events?: FilterResult<ActivityEvent>;
  fragments?: FilterResult<Fragment>;
  nfts?: FilterResult<NFT>;
  pools?: FilterResult<Pool>;
  transfers?: FilterResult<Transfer>;
  balanceChanges?: FilterResult<BalanceChange>;
}

// Upsert types
export interface UpsertManyResult {
  created?: NameAndID[];
  replaced?: NameAndID[];
  updated?: NameAndID[];
  ignored?: NameAndID[];
}

// Bulk input types
export interface AddressBulkInput extends AddressInput, ObjectLabels {
  updateType?: UpdateType;
}

export interface AssetBulkInput extends AssetInput, ObjectLabels {
  updateType?: UpdateType;
}

export interface PoolBulkInput extends Omit<PoolInput, "asset">, ObjectLabels {
  updateType?: UpdateType;
  address?: string;
  asset?: string;
}

export interface ActivityBulkInput extends ActivityInput, ObjectLabels {
  updateType?: UpdateType;
}

export interface CollectionBulkInput extends CollectionInput, ObjectLabels {
  updateType?: UpdateType;
}

export interface DataBulkInput extends DataInput, ObjectLabels {
  updateType?: UpdateType;
  parent?: DataParent;
}

export interface EventBulkInput extends EventInput, ObjectLabels {
  updateType?: UpdateType;
  activity: string;
}

export interface FragmentBulkInput
  extends Omit<FragmentInput, "asset">, ObjectLabels {
  updateType?: UpdateType;
  address?: string;
  asset?: string;
}

export interface NFTBulkInput extends Omit<NFTInput, "asset">, ObjectLabels {
  updateType?: UpdateType;
  address?: string;
  asset?: string;
}

export interface TransferBulkInput extends TransferInput, ObjectLabels {
  updateType?: UpdateType;
  parent: TransferParent;
}

export interface BulkUpsertInput {
  activities?: ActivityBulkInput[];
  addresses?: AddressBulkInput[];
  assets?: AssetBulkInput[];
  collections?: CollectionBulkInput[];
  data?: DataBulkInput[];
  events?: EventBulkInput[];
  fragments?: FragmentBulkInput[];
  nfts?: NFTBulkInput[];
  pools?: PoolBulkInput[];
  transfers?: TransferBulkInput[];
}

export interface BulkUpsertOutput {
  activities?: UpsertManyResult;
  addresses?: UpsertManyResult;
  assets?: UpsertManyResult;
  collections?: UpsertManyResult;
  data?: UpsertManyResult;
  events?: UpsertManyResult;
  fragments?: UpsertManyResult;
  nfts?: UpsertManyResult;
  pools?: UpsertManyResult;
  transfers?: UpsertManyResult;
}

// ============================================================================
// Policy
// ============================================================================

export interface Policy extends KldResourceBase {
  name?: string;
  currentVersion?: string;
  description?: string;
}

export interface PolicyInlineVersion {
  name?: string;
  description?: string;
  version?: string;
  document?: string;
}

export interface PolicyInlineInvoke extends PolicyInlineVersion {
  input?: any;
}

export interface PolicyVersion {
  id: string;
  name?: string;
  hash?: string;
  policyId?: string;
  document?: string;
  exampleInput?: string;
  description?: string;
  created?: string;
  updated?: string;
}

export interface PolicyVersionUpdate {
  description?: string;
}

export interface PolicyVersionInfo {
  name?: string;
  version?: string;
  hash?: string;
}

export interface PolicyInvocationResult {
  policy?: PolicyVersionInfo;
  result?: any;
}

// ============================================================================
// Tasks
// ============================================================================

export interface Task extends KldResourceBase {
  name?: string;
  currentVersion?: string;
  description?: string;
  variableSet?: string;
}

export interface TaskInlineVersion extends Task {
  version?: string;
  steps?: any[];
}

export interface TaskInlineInvoke extends TaskInlineVersion {
  input?: any;
}

export interface TaskVersion extends KldResourceBase {
  name?: string;
  taskId?: string;
  steps?: any[];
  exampleInput?: string;
  description?: string;
}

export interface TaskVersionUpdate {
  description?: string;
}

export interface TaskVersionInfo {
  name?: string;
  version?: string;
  hash?: string;
}

export interface TaskInvocationResult {
  task?: TaskVersionInfo;
  result?: any;
}

// ============================================================================
// Invocation Types
// ============================================================================

export type InvocationStatus =
  | "submitted"
  | "running"
  | "succeeded"
  | "failed"
  | "suspended";
export type InvocationType = "api" | "subscription" | "eventstream";
export type InvocationOutcome =
  | "sync_submitted"
  | "sync_invoked"
  | "sync_failed"
  | "sync_duplicate"
  | "sync_blocked"
  | "async_submitted"
  | "async_duplicate";

export interface InvocationInput {
  idempotencyKey?: string;
  async?: boolean;
  activity?: string;
  taskId?: string;
  taskName?: string;
  taskVersion?: string;
  input?: any;
  retryCondition?: string;
  variableSets?: string[];
}

export interface InvocationResult {
  contentType?: string;
  jsonEncoding?: string;
  data?: any;
  info?: any;
  context?: any;
}

export interface Invocation extends KldResourceBase {
  type?: InvocationType;
  parentId?: string;
  identity?: string;
  identityContext?: any;
  status?: InvocationStatus;
  result?: InvocationResult;
  errorCount?: number;
  invokedVersion?: string;
  startTime?: string;
  lastError?: string;
  lastErrorText?: string;
  idempotencyKey?: string;
  async?: boolean;
  activity?: string;
  taskId?: string;
  taskName?: string;
  taskVersion?: string;
  input?: any;
  retryCondition?: string;
  variableSets?: string[];
}

export interface InvocationSubmitResult {
  outcome: InvocationOutcome;
  duplicate?: string;
  id?: string;
  error?: string;
  errorDetail?: string;
  context?: any;
  retryable?: boolean;
  contentType?: string;
  jsonEncoding?: string;
  data?: any;
  info?: any;
}

export interface StepsCatalogItem {
  name?: string;
  type?: string;
  options?: any;
}

// ============================================================================
// Subscriptions and Listeners
// ============================================================================

export type SubscriptionType = "webhook" | "websocket";

export type DistributionMode = "broadcast" | "load_balance";

export interface WebhookConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  tlsConfig?: {
    insecure?: boolean;
    clientCertificate?: string;
    clientKey?: string;
    caCertificate?: string;
  };
}

export interface WebSocketConfig {
  distributionMode?: DistributionMode;
}

export interface EventStreamSpecFields {
  name?: string;
  topicFilter?: string;
  batchSize?: number;
  batchTimeout?: number;
  blockedRetryDelay?: number;
  initialSequenceID?: string;
}

export interface DataModelSubscriptionInput extends EventStreamSpecFields {
  type?: SubscriptionType;
  webhook?: WebhookConfig;
  websocket?: WebSocketConfig;
}

export interface DataModelSubscription
  extends KldResourceBase, DataModelSubscriptionInput {
  status?: string;
  statistics?: {
    eventsReceived?: number;
    eventsProcessed?: number;
    eventsDelivered?: number;
    eventsDelayed?: number;
  };
}

export interface SubscriptionResetRequest {
  sequenceId?: string;
}

export interface DataModelListenerInput extends EventStreamSpecFields {
  taskId?: string;
  taskName?: string;
  taskVersion?: string;
}

export interface DataModelListener
  extends KldResourceBase, DataModelListenerInput {
  identity?: string;
  identityContext?: any;
  replayCount?: number;
  status?: string;
  statistics?: {
    eventsReceived?: number;
    eventsProcessed?: number;
    eventsDelivered?: number;
    eventsDelayed?: number;
  };
}

export interface DataModelListenerResetRequest {
  sequenceId?: string;
  replay?: boolean;
}

export interface FireFlyListenerConfig {
  namespace?: string;
  taskId?: string;
  taskName?: string;
  taskVersion?: string;
  eventTypes?: string[];
  blockchainEvents?: {
    locations?: any[];
    abiEvents?: any;
    createOptions?: any;
  };
}

export interface FireFlyListenerInput {
  name?: string;
  disabled?: boolean;
  config?: FireFlyListenerConfig;
}

export interface FireFlyListener extends KldResourceBase, FireFlyListenerInput {
  identity?: string;
}

export type { Logger } from "@kaleido-io/core/http";
