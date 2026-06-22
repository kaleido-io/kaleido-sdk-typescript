import { AxiosRequestConfig } from "axios";
import {
  ServiceClient,
  ServiceClientOptions,
  createServiceTransport,
} from "@kaleido-io/core/http";
import { resolveServiceBinding } from "@kaleido-io/core";
import { BulkUpsertBuilder, type BulkUpsertBuilderOptions } from "./bulk-upsert-builder.js";
import {
  Activity,
  ActivityEvent,
  ActivityInput,
  Address,
  AddressInput,
  Asset,
  AssetInput,
  Balance,
  BulkQueryInput,
  BulkQueryOutput,
  BulkUpsertInput,
  BulkUpsertOutput,
  Collection,
  Data,
  DataInput,
  DataModelListener,
  DataModelListenerInput,
  DataModelListenerResetRequest,
  DataModelSubscription,
  DataModelSubscriptionInput,
  EventInput,
  FilterResult,
  FireFlyListener,
  FireFlyListenerInput,
  Fragment,
  FragmentInput,
  Invocation,
  InvocationInput,
  InvocationSubmitResult,
  ItemsResult,
  NFT,
  NFTInput,
  Policy,
  PolicyInlineInvoke,
  PolicyInlineVersion,
  PolicyInvocationResult,
  PolicyVersion,
  PolicyVersionUpdate,
  Pool,
  PoolInput,
  StepsCatalogItem,
  SubscriptionResetRequest,
  Task,
  TaskInlineInvoke,
  TaskInlineVersion,
  TaskVersion,
  TaskVersionUpdate,
  Transfer,
  TransferInput,
  UpsertManyResult,
} from "./asset-manager.interfaces";
import { newLogger, type SetupContext } from "@kaleido-io/workflow-engine-sdk";

const log = newLogger("AssetManagerClient");

/**
 * Typed client for the Asset Manager REST API.
 *
 * Constructor overloads — pick the form that fits your context:
 *
 *   // From a handler context (resolves binding via WFE client):
 *   const am = new AssetManagerClient(ctx);
 *   const am = new AssetManagerClient(ctx, 'asset-manager-2');
 *
 *   // From a binding name (resolves directly from config file):
 *   const am = new AssetManagerClient('asset-manager');
 *
 *   // From explicit options (existing / low-level usage):
 *   const am = new AssetManagerClient(client.getServiceClientOptions('asset-manager'));
 */
// For hosted (ws-proxy) transport the proxy base URL already includes the
// /api/v1/namespaces/<service> prefix, so no API version prefix is needed.
// For non-hosted (http) transport the external URL ends at /rest and requires
// the /api/v1 prefix to reach the API.
function apiVersion(opts: ServiceClientOptions): string {
  if (opts.transport === 'ws-proxy') return '';
  // If the URL already includes /api/v1 (e.g. internal cluster service endpoints
  // like r-xxx-amr.svc.cluster.local:5000/api/v1/namespaces/service), don't add it again.
  if (opts.transport === 'http' && opts.url?.includes('/api/v1')) return '';
  return '/api/v1';
}

function resolveOptions(
  ctxOrOptsOrName: SetupContext | ServiceClientOptions | string,
  bindingName?: string,
): ServiceClientOptions {
  if (typeof ctxOrOptsOrName === 'string') {
    return resolveServiceBinding(ctxOrOptsOrName);
  }
  if ('getServiceClientOptions' in ctxOrOptsOrName) {
    return ctxOrOptsOrName.getServiceClientOptions(bindingName ?? 'asset-manager');
  }
  return ctxOrOptsOrName;
}

export class AssetManagerClient extends ServiceClient {
  private readonly apiVersion: string;

  constructor(ctxOrOptsOrName: SetupContext | ServiceClientOptions | string, bindingName?: string) {
    const opts = resolveOptions(ctxOrOptsOrName, bindingName);
    super(createServiceTransport(opts));
    this.apiVersion = apiVersion(opts);
  }

  /**
   * Create a new BulkUpsertBuilder pre-wired to this client.
   * Each process batch should call this to get a fresh builder with no accumulated state.
   */
  getNewBulkUpsertBuilder(options?: BulkUpsertBuilderOptions): BulkUpsertBuilder {
    return new BulkUpsertBuilder(this, options);
  }

  // Status
  getStatus() {
    return this.get<{ status: string }>(`${this.apiVersion}/status`);
  }

  // Assets
  getAssets(params?: { filter?: any; label?: string[] }) {
    return this.get<ItemsResult<Asset>>(
      `${this.apiVersion}/assets`,
      params?.filter,
    );
  }

  getAsset(nameOrId: string) {
    return this.get<Asset>(`${this.apiVersion}/assets/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  createAsset(asset: AssetInput & { labels?: string[] }) {
    return this.post<Asset>(`${this.apiVersion}/assets`, asset);
  }

  updateAsset(nameOrId: string, asset: Partial<AssetInput>) {
    return this.patch<Asset>(`${this.apiVersion}/assets/${nameOrId}`, asset);
  }

  async deleteAsset(nameOrId: string) {
    await this.delete(`${this.apiVersion}/assets/${nameOrId}`);
  }

  // Addresses
  getAddresses(params?: { filter?: any }) {
    return this.get<ItemsResult<Address>>(
      `${this.apiVersion}/addresses`,
      params?.filter,
    );
  }

  getAddress(address: string) {
    return this.get<Address>(`${this.apiVersion}/addresses/${address}`, undefined, {
      ignore404: true,
    });
  }

  createAddress(address: AddressInput & { labels?: string[] }) {
    return this.post<Address>(`${this.apiVersion}/addresses`, address);
  }

  updateAddress(address: string, updates: Partial<AddressInput>) {
    return this.patch<Address>(`${this.apiVersion}/addresses/${address}`, updates);
  }

  async deleteAddress(address: string) {
    await this.delete(`${this.apiVersion}/addresses/${address}`);
  }

  // Pools
  getPools(params?: { filter?: any; label?: string[] }) {
    return this.get<ItemsResult<Pool>>(`${this.apiVersion}/pools`, params?.filter);
  }

  getPool(nameOrId: string) {
    return this.get<Pool>(`${this.apiVersion}/pools/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  createPool(pool: PoolInput & { labels?: string[] }) {
    return this.post<Pool>(`${this.apiVersion}/pools`, pool);
  }

  updatePool(nameOrId: string, updates: Partial<PoolInput>) {
    return this.patch<Pool>(`${this.apiVersion}/pools/${nameOrId}`, updates);
  }

  async deletePool(nameOrId: string) {
    await this.delete(`${this.apiVersion}/pools/${nameOrId}`);
  }

  // Collections
  getCollections(params?: { filter?: any }) {
    return this.get<ItemsResult<Collection>>(
      `${this.apiVersion}/collections`,
      params?.filter,
    );
  }

  getCollection(nameOrId: string) {
    return this.get<Collection>(
      `${this.apiVersion}/collections/${nameOrId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createCollection(collection: {
    name?: string;
    displayName?: string;
    description?: string;
    labels?: string[];
  }) {
    return this.post<Collection>(`${this.apiVersion}/collections`, collection);
  }

  updateCollection(
    nameOrId: string,
    updates: { displayName?: string; description?: string },
  ) {
    return this.patch<Collection>(
      `${this.apiVersion}/collections/${nameOrId}`,
      updates,
    );
  }

  async deleteCollection(nameOrId: string) {
    await this.delete(`${this.apiVersion}/collections/${nameOrId}`);
  }

  // Activities
  getActivities(params?: { filter?: any; label?: string[] }) {
    return this.get<ItemsResult<Activity>>(
      `${this.apiVersion}/activities`,
      params?.filter,
    );
  }

  getActivity(nameOrId: string) {
    return this.get<Activity>(
      `${this.apiVersion}/activities/${nameOrId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createActivity(activity: ActivityInput & { labels?: string[] }) {
    return this.post<Activity>(`${this.apiVersion}/activities`, activity);
  }

  updateActivity(nameOrId: string, updates: Partial<ActivityInput>) {
    return this.patch<Activity>(
      `${this.apiVersion}/activities/${nameOrId}`,
      updates,
    );
  }

  async deleteActivity(nameOrId: string) {
    await this.delete(`${this.apiVersion}/activities/${nameOrId}`);
  }

  // Data
  getData(params?: { filter?: any; label?: string[] }) {
    return this.get<ItemsResult<Data>>(`${this.apiVersion}/data`, params?.filter);
  }

  getDataSingle(nameOrId: string) {
    return this.get<Data>(`${this.apiVersion}/data/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  createData(data: DataInput & { labels?: string[] }) {
    return this.post<Data>(`${this.apiVersion}/data`, data);
  }

  updateData(nameOrId: string, updates: Partial<DataInput>) {
    return this.patch<Data>(`${this.apiVersion}/data/${nameOrId}`, updates);
  }

  async deleteData(nameOrId: string) {
    await this.delete(`${this.apiVersion}/data/${nameOrId}`);
  }

  // Events
  getEvents(params?: { filter?: any }) {
    return this.get<ItemsResult<ActivityEvent>>(
      `${this.apiVersion}/events`,
      params?.filter,
    );
  }

  getEvent(nameOrId: string) {
    return this.get<ActivityEvent>(
      `${this.apiVersion}/events/${nameOrId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createEvent(event: EventInput & { labels?: string[] }) {
    return this.post<ActivityEvent>(`${this.apiVersion}/events`, event);
  }

  updateEvent(nameOrId: string, updates: Partial<EventInput>) {
    return this.patch<ActivityEvent>(
      `${this.apiVersion}/events/${nameOrId}`,
      updates,
    );
  }

  async deleteEvent(nameOrId: string) {
    await this.delete(`${this.apiVersion}/events/${nameOrId}`);
  }

  // Fragments
  getFragments(params?: { filter?: any }) {
    return this.get<ItemsResult<Fragment>>(
      `${this.apiVersion}/fragments`,
      params?.filter,
    );
  }

  getFragment(nameOrId: string) {
    return this.get<Fragment>(
      `${this.apiVersion}/fragments/${nameOrId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createFragment(fragment: FragmentInput & { labels?: string[] }) {
    return this.post<Fragment>(`${this.apiVersion}/fragments`, fragment);
  }

  updateFragment(nameOrId: string, updates: Partial<FragmentInput>) {
    return this.patch<Fragment>(
      `${this.apiVersion}/fragments/${nameOrId}`,
      updates,
    );
  }

  async deleteFragment(nameOrId: string) {
    await this.delete(`${this.apiVersion}/fragments/${nameOrId}`);
  }

  // NFTs
  getNFTs(params?: { filter?: any }) {
    return this.get<ItemsResult<NFT>>(`${this.apiVersion}/nfts`, params?.filter);
  }

  getNFT(nameOrId: string) {
    return this.get<NFT>(`${this.apiVersion}/nfts/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  createNFT(nft: NFTInput & { labels?: string[] }) {
    return this.post<NFT>(`${this.apiVersion}/nfts`, nft);
  }

  updateNFT(nameOrId: string, updates: Partial<NFTInput>) {
    return this.patch<NFT>(`${this.apiVersion}/nfts/${nameOrId}`, updates);
  }

  async deleteNFT(nameOrId: string) {
    await this.delete(`${this.apiVersion}/nfts/${nameOrId}`);
  }

  // Transfers
  getTransfers(params?: { filter?: any }) {
    return this.get<ItemsResult<Transfer>>(
      `${this.apiVersion}/transfers`,
      params?.filter,
    );
  }

  getTransfer(transferId: string) {
    return this.get<Transfer>(
      `${this.apiVersion}/transfers/${transferId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createTransfer(transfer: TransferInput & { labels?: string[] }) {
    return this.post<Transfer>(`${this.apiVersion}/transfers`, transfer);
  }

  updateTransfer(transferId: string, updates: Partial<TransferInput>) {
    return this.patch<Transfer>(
      `${this.apiVersion}/transfers/${transferId}`,
      updates,
    );
  }

  async deleteTransfer(transferId: string) {
    await this.delete(`${this.apiVersion}/transfers/${transferId}`);
  }

  // Balances
  getBalances(params?: { filter?: any }) {
    return this.get<ItemsResult<Balance>>(
      `${this.apiVersion}/balances`,
      params?.filter,
    );
  }

  getBalance(nameOrId: string) {
    return this.get<Balance>(`${this.apiVersion}/balances/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  getAddressBalances(address: string, params?: { filter?: any }) {
    return this.get<ItemsResult<Balance>>(
      `${this.apiVersion}/addresses/${address}/balances`,
      params?.filter,
    );
  }

  getAssetBalances(assetNameOrId: string, params?: { filter?: any }) {
    return this.get<ItemsResult<Balance>>(
      `${this.apiVersion}/assets/${assetNameOrId}/balances`,
      params?.filter,
    );
  }

  getPoolBalances(poolNameOrId: string, params?: { filter?: any }) {
    return this.get<ItemsResult<Balance>>(
      `${this.apiVersion}/pools/${poolNameOrId}/balances`,
      params?.filter,
    );
  }

  // Bulk Operations
  async bulkQuery(input: BulkQueryInput) {
    const startTime = new Date().getTime();
    const res = await this.post<BulkQueryOutput>(`${this.apiVersion}/bulk/query`, input, {
      retryOn5xx: true,
    });
    const countFor = (collection: string, set?: FilterResult<unknown>) =>
      (typeof set === 'object' && set.count) ? ` ${collection}=${set.count}` : '';
    log.debug(`bulkQuery${countFor('assets', res?.assets)}${countFor('activities', res?.activities)}${countFor('addresses', res?.addresses)}${countFor('collections', res?.collections)}${countFor('data', res?.data)}${countFor('events', res?.events)}${countFor('fragments', res?.fragments)}${countFor('nfts', res?.nfts)}${countFor('pools', res?.pools)}${countFor('transfers', res?.transfers)}${countFor('balanceChanges', res?.balanceChanges)} (${new Date().getTime()-startTime}ms)`)
    return res;
  }

  async bulkUpsert(input: BulkUpsertInput, options?: AxiosRequestConfig) {
    const startTime = new Date().getTime();
    const res = await this.put<BulkUpsertOutput>(`${this.apiVersion}/bulk/datamodel`, input, options);
    const countFor = (collection: string, set?: UpsertManyResult) => {
      if (typeof set !== 'object') return '-';
      const c = set.created?.length ?? 0, r = set.replaced?.length ?? 0, u = set.updated?.length ?? 0, i = set.ignored?.length ?? 0;
      return (c || r || u || i) ? ` ${collection}=[c=${c},r=${r},u=${u},i=${i}]` : '';
    };
    log.debug(`bulkUpsert${countFor('assets', res?.assets)}${countFor('activities', res?.activities)}${countFor('addresses', res?.addresses)}${countFor('collections', res?.collections)}${countFor('data', res?.data)}${countFor('events', res?.events)}${countFor('fragments', res?.fragments)}${countFor('nfts', res?.nfts)}${countFor('pools', res?.pools)}${countFor('transfers', res?.transfers)} (${new Date().getTime()-startTime}ms)`)
    return res;
  }

  // Policy Operations
  getPolicies(params?: { filter?: any }) {
    return this.get<ItemsResult<Policy>>(
      `${this.apiVersion}/policies`,
      params?.filter,
    );
  }

  getPolicy(policyNameOrId: string, options?: { withActive?: boolean }) {
    return this.get<Policy>(
      `${this.apiVersion}/policies/${policyNameOrId}`,
      { withActive: options?.withActive },
      { ignore404: true },
    );
  }

  replacePolicy(policyNameOrId: string, policy: PolicyInlineVersion) {
    return this.put<PolicyInlineVersion>(
      `${this.apiVersion}/policies/${policyNameOrId}`,
      policy,
    );
  }

  updatePolicy(policyNameOrId: string, updates: Partial<Policy>) {
    return this.patch<Policy>(
      `${this.apiVersion}/policies/${policyNameOrId}`,
      updates,
    );
  }

  async deletePolicy(policyNameOrId: string) {
    await this.delete(`${this.apiVersion}/policies/${policyNameOrId}`);
  }

  invokePolicy(policyNameOrId: string, input: any) {
    return this.post<PolicyInvocationResult>(
      `${this.apiVersion}/policies/${policyNameOrId}/invoke`,
      input,
    );
  }

  invokeInlinePolicy(policy: PolicyInlineInvoke) {
    return this.post<PolicyInvocationResult>(
      `${this.apiVersion}/inline/policy/invoke`,
      policy,
    );
  }

  // Policy Version Operations
  getPolicyVersions(policyNameOrId: string, params?: { filter?: any }) {
    return this.get<ItemsResult<PolicyVersion>>(
      `${this.apiVersion}/policies/${policyNameOrId}/versions`,
      params?.filter,
    );
  }

  getPolicyVersion(policyNameOrId: string, version: string) {
    return this.get<PolicyVersion>(
      `${this.apiVersion}/policies/${policyNameOrId}/versions/${version}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createPolicyVersion(
    policyNameOrId: string,
    version: PolicyVersion,
    options?: { inactive?: boolean },
  ) {
    const params =
      options?.inactive !== undefined
        ? { inactive: options.inactive }
        : undefined;
    return this.post<PolicyVersion>(
      `${this.apiVersion}/policies/${policyNameOrId}/versions`,
      version,
      {
        params,
      },
    );
  }

  updatePolicyVersion(
    policyNameOrId: string,
    version: string,
    updates: PolicyVersionUpdate,
  ) {
    return this.patch<PolicyVersion>(
      `${this.apiVersion}/policies/${policyNameOrId}/versions/${version}`,
      updates,
    );
  }

  async deletePolicyVersion(policyNameOrId: string, version: string) {
    await this.delete(
      `${this.apiVersion}/policies/${policyNameOrId}/versions/${version}`,
    );
  }

  invokePolicyVersion(policyNameOrId: string, version: string, input: any) {
    return this.post<PolicyInvocationResult>(
      `${this.apiVersion}/policies/${policyNameOrId}/versions/${version}/invoke`,
      input,
    );
  }

  // Task Operations
  getTasks(params?: { filter?: any }) {
    return this.get<ItemsResult<Task>>(`${this.apiVersion}/tasks`, params?.filter);
  }

  getTask(taskNameOrId: string, options?: { withActive?: boolean }) {
    const params =
      options?.withActive !== undefined
        ? { withActive: options.withActive }
        : undefined;
    return this.get<TaskInlineVersion>(
      `${this.apiVersion}/tasks/${taskNameOrId}`,
      params,
      {
        ignore404: true,
      },
    );
  }

  replaceTask(taskNameOrId: string, task: TaskInlineVersion) {
    return this.put<TaskInlineVersion>(
      `${this.apiVersion}/tasks/${taskNameOrId}`,
      task,
    );
  }

  updateTask(taskNameOrId: string, updates: Partial<Task>) {
    return this.patch<Task>(`${this.apiVersion}/tasks/${taskNameOrId}`, updates);
  }

  async deleteTask(taskNameOrId: string) {
    await this.delete(`${this.apiVersion}/tasks/${taskNameOrId}`);
  }

  invokeTask(
    taskNameOrId: string,
    input: InvocationInput,
    options?: { returnFullContext?: boolean },
  ) {
    const params =
      options?.returnFullContext !== undefined
        ? { returnFullContext: options.returnFullContext }
        : undefined;
    return this.post<InvocationSubmitResult>(
      `${this.apiVersion}/tasks/${taskNameOrId}/invoke`,
      input,
      {
        params,
      },
    );
  }

  invokeInlineTask(
    task: TaskInlineInvoke,
    options?: { returnFullContext?: boolean },
  ) {
    const params =
      options?.returnFullContext !== undefined
        ? { returnFullContext: options.returnFullContext }
        : undefined;
    return this.post<InvocationSubmitResult>(
      `${this.apiVersion}/inline/task/invoke`,
      task,
      { params },
    );
  }

  // Task Version Operations
  getTaskVersions(taskNameOrId: string, params?: { filter?: any }) {
    return this.get<ItemsResult<TaskVersion>>(
      `${this.apiVersion}/tasks/${taskNameOrId}/versions`,
      params?.filter,
    );
  }

  getTaskVersion(taskNameOrId: string, version: string) {
    return this.get<TaskVersion>(
      `${this.apiVersion}/tasks/${taskNameOrId}/versions/${version}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createTaskVersion(
    taskNameOrId: string,
    version: TaskVersion,
    options?: { inactive?: boolean },
  ) {
    const params =
      options?.inactive !== undefined
        ? { inactive: options.inactive }
        : undefined;
    return this.post<TaskVersion>(
      `${this.apiVersion}/tasks/${taskNameOrId}/versions`,
      version,
      { params },
    );
  }

  updateTaskVersion(
    taskNameOrId: string,
    version: string,
    updates: TaskVersionUpdate,
  ) {
    return this.patch<TaskVersion>(
      `${this.apiVersion}/tasks/${taskNameOrId}/versions/${version}`,
      updates,
    );
  }

  async deleteTaskVersion(taskNameOrId: string, version: string) {
    await this.delete(
      `${this.apiVersion}/tasks/${taskNameOrId}/versions/${version}`,
    );
  }

  invokeTaskVersion(
    taskNameOrId: string,
    version: string,
    input: InvocationInput,
    options?: { returnFullContext?: boolean },
  ) {
    const params =
      options?.returnFullContext !== undefined
        ? { returnFullContext: options.returnFullContext }
        : undefined;
    return this.post<InvocationSubmitResult>(
      `${this.apiVersion}/tasks/${taskNameOrId}/versions/${version}/invoke`,
      input,
      { params },
    );
  }

  // Invocation Operations
  getInvocations(params?: { filter?: any }) {
    return this.get<ItemsResult<Invocation>>(
      `${this.apiVersion}/invocations`,
      params?.filter,
    );
  }

  getInvocation(invocationId: string) {
    return this.get<Invocation>(
      `${this.apiVersion}/invocations/${invocationId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  async deleteInvocation(invocationId: string) {
    await this.delete(`${this.apiVersion}/invocations/${invocationId}`);
  }

  invocationFail(
    invocationId: string,
    error: {
      message: string;
      detail?: string;
      retryable?: boolean;
      context?: any;
    },
  ) {
    return this.post(`${this.apiVersion}/invocations/${invocationId}/fail`, error);
  }

  invocationReplay(invocationId: string) {
    return this.post(`${this.apiVersion}/invocations/${invocationId}/replay`, {});
  }

  invocationSuspend(invocationId: string) {
    return this.post(`${this.apiVersion}/invocations/${invocationId}/suspend`, {});
  }

  invocationResume(invocationId: string) {
    return this.post(`${this.apiVersion}/invocations/${invocationId}/resume`, {});
  }

  // Steps Catalog
  getStepsCatalog() {
    return this.get<ItemsResult<StepsCatalogItem>>(
      `${this.apiVersion}/steps/catalog`,
    );
  }

  // Subscriptions
  getSubscriptions(params?: { filter?: any }) {
    return this.get<ItemsResult<DataModelSubscription>>(
      `${this.apiVersion}/subscriptions`,
      params?.filter,
    );
  }

  getSubscription(subscriptionNameOrId: string) {
    return this.get<DataModelSubscription>(
      `${this.apiVersion}/subscriptions/${subscriptionNameOrId}`,
      undefined,
      { ignore404: true },
    );
  }

  replaceSubscription(
    subscriptionNameOrId: string,
    subscription: DataModelSubscriptionInput,
  ) {
    return this.put<DataModelSubscription>(
      `${this.apiVersion}/subscriptions/${subscriptionNameOrId}`,
      subscription,
    );
  }

  async deleteSubscription(subscriptionNameOrId: string) {
    await this.delete(`${this.apiVersion}/subscriptions/${subscriptionNameOrId}`);
  }

  subscriptionStart(subscriptionNameOrId: string) {
    return this.post(
      `${this.apiVersion}/subscriptions/${subscriptionNameOrId}/start`,
      {},
    );
  }

  subscriptionStop(subscriptionNameOrId: string) {
    return this.post(
      `${this.apiVersion}/subscriptions/${subscriptionNameOrId}/stop`,
      {},
    );
  }

  subscriptionReset(
    subscriptionNameOrId: string,
    request: SubscriptionResetRequest,
  ) {
    return this.post(
      `${this.apiVersion}/subscriptions/${subscriptionNameOrId}/reset`,
      request,
    );
  }

  // Data Model Listeners
  getDataModelListeners(params?: { filter?: any }) {
    return this.get<ItemsResult<DataModelListener>>(
      `${this.apiVersion}/listeners/datamodel`,
      params?.filter,
    );
  }

  getDataModelListener(listenerNameOrId: string) {
    return this.get<DataModelListener>(
      `${this.apiVersion}/listeners/datamodel/${listenerNameOrId}`,
      undefined,
      { ignore404: true },
    );
  }

  replaceDataModelListener(
    listenerNameOrId: string,
    listener: DataModelListenerInput,
  ) {
    return this.put<DataModelListener>(
      `${this.apiVersion}/listeners/datamodel/${listenerNameOrId}`,
      listener,
    );
  }

  async deleteDataModelListener(listenerNameOrId: string) {
    await this.delete(`${this.apiVersion}/listeners/datamodel/${listenerNameOrId}`);
  }

  dataModelListenerStart(listenerNameOrId: string) {
    return this.post(
      `${this.apiVersion}/listeners/datamodel/${listenerNameOrId}/start`,
      {},
    );
  }

  dataModelListenerStop(listenerNameOrId: string) {
    return this.post(
      `${this.apiVersion}/listeners/datamodel/${listenerNameOrId}/stop`,
      {},
    );
  }

  dataModelListenerReset(
    listenerNameOrId: string,
    request: DataModelListenerResetRequest,
  ) {
    return this.post(
      `${this.apiVersion}/listeners/datamodel/${listenerNameOrId}/reset`,
      request,
    );
  }

  // FireFly Listeners
  getFireFlyListeners(params?: { filter?: any }) {
    return this.get<ItemsResult<FireFlyListener>>(
      `${this.apiVersion}/listeners/firefly`,
      params?.filter,
    );
  }

  getFireFlyListener(listenerNameOrId: string) {
    return this.get<FireFlyListener>(
      `${this.apiVersion}/listeners/firefly/${listenerNameOrId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  replaceFireFlyListener(
    listenerNameOrId: string,
    listener: FireFlyListenerInput,
  ) {
    return this.put<FireFlyListener>(
      `${this.apiVersion}/listeners/firefly/${listenerNameOrId}`,
      listener,
    );
  }

  async deleteFireFlyListener(listenerNameOrId: string) {
    await this.delete(`${this.apiVersion}/listeners/firefly/${listenerNameOrId}`);
  }

  fireflyListenerStart(listenerNameOrId: string) {
    return this.post(
      `${this.apiVersion}/listeners/firefly/${listenerNameOrId}/start`,
      {},
    );
  }

  fireflyListenerStop(listenerNameOrId: string) {
    return this.post(
      `${this.apiVersion}/listeners/firefly/${listenerNameOrId}/stop`,
      {},
    );
  }
}
