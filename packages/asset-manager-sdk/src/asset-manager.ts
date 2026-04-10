import {
  ServiceClient,
  ServiceClientOptions,
  createServiceTransport,
} from "@kaleido-io/core/http";
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
} from "./asset-manager.interfaces";
/**
 * Typed client for the Asset Manager REST API.
 *
 * Extends ServiceClient — the transport-agnostic base from the SDK.
 * The actual transport (direct HTTP vs WS proxy) is determined at
 * construction time by the ServiceClientOptions discriminator.
 *
 * Usage:
 *   const options = client.getServiceClientOptions('asset-manager');
 *   const am = new AssetManagerClient(options);
 *   await am.bulkUpsert({ assets: [{ name: 'my-asset', ... }] });
 */
const API_VERSION = "/api/v1";

export class AssetManagerClient extends ServiceClient {
  constructor(options: ServiceClientOptions) {
    super(createServiceTransport(options));
  }

  // Status
  getStatus() {
    return this.get<{ status: string }>(`${API_VERSION}/status`);
  }

  // Assets
  getAssets(params?: { filter?: any; label?: string[] }) {
    return this.get<ItemsResult<Asset>>(
      `${API_VERSION}/assets`,
      params?.filter,
    );
  }

  getAsset(nameOrId: string) {
    return this.get<Asset>(`${API_VERSION}/assets/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  createAsset(asset: AssetInput & { labels?: string[] }) {
    return this.post<Asset>(`${API_VERSION}/assets`, asset);
  }

  updateAsset(nameOrId: string, asset: Partial<AssetInput>) {
    return this.patch<Asset>(`${API_VERSION}/assets/${nameOrId}`, asset);
  }

  async deleteAsset(nameOrId: string) {
    await this.delete(`${API_VERSION}/assets/${nameOrId}`);
  }

  // Addresses
  getAddresses(params?: { filter?: any }) {
    return this.get<ItemsResult<Address>>(
      `${API_VERSION}/addresses`,
      params?.filter,
    );
  }

  getAddress(address: string) {
    return this.get<Address>(`${API_VERSION}/addresses/${address}`, undefined, {
      ignore404: true,
    });
  }

  createAddress(address: AddressInput & { labels?: string[] }) {
    return this.post<Address>(`${API_VERSION}/addresses`, address);
  }

  updateAddress(address: string, updates: Partial<AddressInput>) {
    return this.patch<Address>(`${API_VERSION}/addresses/${address}`, updates);
  }

  async deleteAddress(address: string) {
    await this.delete(`${API_VERSION}/addresses/${address}`);
  }

  // Pools
  getPools(params?: { filter?: any; label?: string[] }) {
    return this.get<ItemsResult<Pool>>(`${API_VERSION}/pools`, params?.filter);
  }

  getPool(nameOrId: string) {
    return this.get<Pool>(`${API_VERSION}/pools/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  createPool(pool: PoolInput & { labels?: string[] }) {
    return this.post<Pool>(`${API_VERSION}/pools`, pool);
  }

  updatePool(nameOrId: string, updates: Partial<PoolInput>) {
    return this.patch<Pool>(`${API_VERSION}/pools/${nameOrId}`, updates);
  }

  async deletePool(nameOrId: string) {
    await this.delete(`${API_VERSION}/pools/${nameOrId}`);
  }

  // Collections
  getCollections(params?: { filter?: any }) {
    return this.get<ItemsResult<Collection>>(
      `${API_VERSION}/collections`,
      params?.filter,
    );
  }

  getCollection(nameOrId: string) {
    return this.get<Collection>(
      `${API_VERSION}/collections/${nameOrId}`,
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
    return this.post<Collection>(`${API_VERSION}/collections`, collection);
  }

  updateCollection(
    nameOrId: string,
    updates: { displayName?: string; description?: string },
  ) {
    return this.patch<Collection>(
      `${API_VERSION}/collections/${nameOrId}`,
      updates,
    );
  }

  async deleteCollection(nameOrId: string) {
    await this.delete(`${API_VERSION}/collections/${nameOrId}`);
  }

  // Activities
  getActivities(params?: { filter?: any; label?: string[] }) {
    return this.get<ItemsResult<Activity>>(
      `${API_VERSION}/activities`,
      params?.filter,
    );
  }

  getActivity(nameOrId: string) {
    return this.get<Activity>(
      `${API_VERSION}/activities/${nameOrId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createActivity(activity: ActivityInput & { labels?: string[] }) {
    return this.post<Activity>(`${API_VERSION}/activities`, activity);
  }

  updateActivity(nameOrId: string, updates: Partial<ActivityInput>) {
    return this.patch<Activity>(
      `${API_VERSION}/activities/${nameOrId}`,
      updates,
    );
  }

  async deleteActivity(nameOrId: string) {
    await this.delete(`${API_VERSION}/activities/${nameOrId}`);
  }

  // Data
  getData(params?: { filter?: any; label?: string[] }) {
    return this.get<ItemsResult<Data>>(`${API_VERSION}/data`, params?.filter);
  }

  getDataSingle(nameOrId: string) {
    return this.get<Data>(`${API_VERSION}/data/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  createData(data: DataInput & { labels?: string[] }) {
    return this.post<Data>(`${API_VERSION}/data`, data);
  }

  updateData(nameOrId: string, updates: Partial<DataInput>) {
    return this.patch<Data>(`${API_VERSION}/data/${nameOrId}`, updates);
  }

  async deleteData(nameOrId: string) {
    await this.delete(`${API_VERSION}/data/${nameOrId}`);
  }

  // Events
  getEvents(params?: { filter?: any }) {
    return this.get<ItemsResult<ActivityEvent>>(
      `${API_VERSION}/events`,
      params?.filter,
    );
  }

  getEvent(nameOrId: string) {
    return this.get<ActivityEvent>(
      `${API_VERSION}/events/${nameOrId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createEvent(event: EventInput & { labels?: string[] }) {
    return this.post<ActivityEvent>(`${API_VERSION}/events`, event);
  }

  updateEvent(nameOrId: string, updates: Partial<EventInput>) {
    return this.patch<ActivityEvent>(
      `${API_VERSION}/events/${nameOrId}`,
      updates,
    );
  }

  async deleteEvent(nameOrId: string) {
    await this.delete(`${API_VERSION}/events/${nameOrId}`);
  }

  // Fragments
  getFragments(params?: { filter?: any }) {
    return this.get<ItemsResult<Fragment>>(
      `${API_VERSION}/fragments`,
      params?.filter,
    );
  }

  getFragment(nameOrId: string) {
    return this.get<Fragment>(
      `${API_VERSION}/fragments/${nameOrId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createFragment(fragment: FragmentInput & { labels?: string[] }) {
    return this.post<Fragment>(`${API_VERSION}/fragments`, fragment);
  }

  updateFragment(nameOrId: string, updates: Partial<FragmentInput>) {
    return this.patch<Fragment>(
      `${API_VERSION}/fragments/${nameOrId}`,
      updates,
    );
  }

  async deleteFragment(nameOrId: string) {
    await this.delete(`${API_VERSION}/fragments/${nameOrId}`);
  }

  // NFTs
  getNFTs(params?: { filter?: any }) {
    return this.get<ItemsResult<NFT>>(`${API_VERSION}/nfts`, params?.filter);
  }

  getNFT(nameOrId: string) {
    return this.get<NFT>(`${API_VERSION}/nfts/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  createNFT(nft: NFTInput & { labels?: string[] }) {
    return this.post<NFT>(`${API_VERSION}/nfts`, nft);
  }

  updateNFT(nameOrId: string, updates: Partial<NFTInput>) {
    return this.patch<NFT>(`${API_VERSION}/nfts/${nameOrId}`, updates);
  }

  async deleteNFT(nameOrId: string) {
    await this.delete(`${API_VERSION}/nfts/${nameOrId}`);
  }

  // Transfers
  getTransfers(params?: { filter?: any }) {
    return this.get<ItemsResult<Transfer>>(
      `${API_VERSION}/transfers`,
      params?.filter,
    );
  }

  getTransfer(transferId: string) {
    return this.get<Transfer>(
      `${API_VERSION}/transfers/${transferId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  createTransfer(transfer: TransferInput & { labels?: string[] }) {
    return this.post<Transfer>(`${API_VERSION}/transfers`, transfer);
  }

  updateTransfer(transferId: string, updates: Partial<TransferInput>) {
    return this.patch<Transfer>(
      `${API_VERSION}/transfers/${transferId}`,
      updates,
    );
  }

  async deleteTransfer(transferId: string) {
    await this.delete(`${API_VERSION}/transfers/${transferId}`);
  }

  // Balances
  getBalances(params?: { filter?: any }) {
    return this.get<ItemsResult<Balance>>(
      `${API_VERSION}/balances`,
      params?.filter,
    );
  }

  getBalance(nameOrId: string) {
    return this.get<Balance>(`${API_VERSION}/balances/${nameOrId}`, undefined, {
      ignore404: true,
    });
  }

  getAddressBalances(address: string, params?: { filter?: any }) {
    return this.get<ItemsResult<Balance>>(
      `${API_VERSION}/addresses/${address}/balances`,
      params?.filter,
    );
  }

  getAssetBalances(assetNameOrId: string, params?: { filter?: any }) {
    return this.get<ItemsResult<Balance>>(
      `${API_VERSION}/assets/${assetNameOrId}/balances`,
      params?.filter,
    );
  }

  getPoolBalances(poolNameOrId: string, params?: { filter?: any }) {
    return this.get<ItemsResult<Balance>>(
      `${API_VERSION}/pools/${poolNameOrId}/balances`,
      params?.filter,
    );
  }

  // Bulk Operations
  bulkQuery(input: BulkQueryInput) {
    return this.post<BulkQueryOutput>(`${API_VERSION}/bulk/query`, input, {
      retryOn5xx: true,
    });
  }

  bulkUpsert(input: BulkUpsertInput) {
    return this.put<BulkUpsertOutput>(`${API_VERSION}/bulk/datamodel`, input);
  }

  // Policy Operations
  getPolicies(params?: { filter?: any }) {
    return this.get<ItemsResult<Policy>>(
      `${API_VERSION}/policies`,
      params?.filter,
    );
  }

  getPolicy(policyNameOrId: string, options?: { withActive?: boolean }) {
    return this.get<Policy>(
      `${API_VERSION}/policies/${policyNameOrId}`,
      { withActive: options?.withActive },
      { ignore404: true },
    );
  }

  replacePolicy(policyNameOrId: string, policy: PolicyInlineVersion) {
    return this.put<PolicyInlineVersion>(
      `${API_VERSION}/policies/${policyNameOrId}`,
      policy,
    );
  }

  updatePolicy(policyNameOrId: string, updates: Partial<Policy>) {
    return this.patch<Policy>(
      `${API_VERSION}/policies/${policyNameOrId}`,
      updates,
    );
  }

  async deletePolicy(policyNameOrId: string) {
    await this.delete(`${API_VERSION}/policies/${policyNameOrId}`);
  }

  invokePolicy(policyNameOrId: string, input: any) {
    return this.post<PolicyInvocationResult>(
      `${API_VERSION}/policies/${policyNameOrId}/invoke`,
      input,
    );
  }

  invokeInlinePolicy(policy: PolicyInlineInvoke) {
    return this.post<PolicyInvocationResult>(
      `${API_VERSION}/inline/policy/invoke`,
      policy,
    );
  }

  // Policy Version Operations
  getPolicyVersions(policyNameOrId: string, params?: { filter?: any }) {
    return this.get<ItemsResult<PolicyVersion>>(
      `${API_VERSION}/policies/${policyNameOrId}/versions`,
      params?.filter,
    );
  }

  getPolicyVersion(policyNameOrId: string, version: string) {
    return this.get<PolicyVersion>(
      `${API_VERSION}/policies/${policyNameOrId}/versions/${version}`,
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
      `${API_VERSION}/policies/${policyNameOrId}/versions`,
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
      `${API_VERSION}/policies/${policyNameOrId}/versions/${version}`,
      updates,
    );
  }

  async deletePolicyVersion(policyNameOrId: string, version: string) {
    await this.delete(
      `${API_VERSION}/policies/${policyNameOrId}/versions/${version}`,
    );
  }

  invokePolicyVersion(policyNameOrId: string, version: string, input: any) {
    return this.post<PolicyInvocationResult>(
      `${API_VERSION}/policies/${policyNameOrId}/versions/${version}/invoke`,
      input,
    );
  }

  // Task Operations
  getTasks(params?: { filter?: any }) {
    return this.get<ItemsResult<Task>>(`${API_VERSION}/tasks`, params?.filter);
  }

  getTask(taskNameOrId: string, options?: { withActive?: boolean }) {
    const params =
      options?.withActive !== undefined
        ? { withActive: options.withActive }
        : undefined;
    return this.get<TaskInlineVersion>(
      `${API_VERSION}/tasks/${taskNameOrId}`,
      params,
      {
        ignore404: true,
      },
    );
  }

  replaceTask(taskNameOrId: string, task: TaskInlineVersion) {
    return this.put<TaskInlineVersion>(
      `${API_VERSION}/tasks/${taskNameOrId}`,
      task,
    );
  }

  updateTask(taskNameOrId: string, updates: Partial<Task>) {
    return this.patch<Task>(`${API_VERSION}/tasks/${taskNameOrId}`, updates);
  }

  async deleteTask(taskNameOrId: string) {
    await this.delete(`${API_VERSION}/tasks/${taskNameOrId}`);
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
      `${API_VERSION}/tasks/${taskNameOrId}/invoke`,
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
      `${API_VERSION}/inline/task/invoke`,
      task,
      { params },
    );
  }

  // Task Version Operations
  getTaskVersions(taskNameOrId: string, params?: { filter?: any }) {
    return this.get<ItemsResult<TaskVersion>>(
      `${API_VERSION}/tasks/${taskNameOrId}/versions`,
      params?.filter,
    );
  }

  getTaskVersion(taskNameOrId: string, version: string) {
    return this.get<TaskVersion>(
      `${API_VERSION}/tasks/${taskNameOrId}/versions/${version}`,
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
      `${API_VERSION}/tasks/${taskNameOrId}/versions`,
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
      `${API_VERSION}/tasks/${taskNameOrId}/versions/${version}`,
      updates,
    );
  }

  async deleteTaskVersion(taskNameOrId: string, version: string) {
    await this.delete(
      `${API_VERSION}/tasks/${taskNameOrId}/versions/${version}`,
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
      `${API_VERSION}/tasks/${taskNameOrId}/versions/${version}/invoke`,
      input,
      { params },
    );
  }

  // Invocation Operations
  getInvocations(params?: { filter?: any }) {
    return this.get<ItemsResult<Invocation>>(
      `${API_VERSION}/invocations`,
      params?.filter,
    );
  }

  getInvocation(invocationId: string) {
    return this.get<Invocation>(
      `${API_VERSION}/invocations/${invocationId}`,
      undefined,
      {
        ignore404: true,
      },
    );
  }

  async deleteInvocation(invocationId: string) {
    await this.delete(`${API_VERSION}/invocations/${invocationId}`);
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
    return this.post(`${API_VERSION}/invocations/${invocationId}/fail`, error);
  }

  invocationReplay(invocationId: string) {
    return this.post(`${API_VERSION}/invocations/${invocationId}/replay`, {});
  }

  invocationSuspend(invocationId: string) {
    return this.post(`${API_VERSION}/invocations/${invocationId}/suspend`, {});
  }

  invocationResume(invocationId: string) {
    return this.post(`${API_VERSION}/invocations/${invocationId}/resume`, {});
  }

  // Steps Catalog
  getStepsCatalog() {
    return this.get<ItemsResult<StepsCatalogItem>>(
      `${API_VERSION}/steps/catalog`,
    );
  }

  // Subscriptions
  getSubscriptions(params?: { filter?: any }) {
    return this.get<ItemsResult<DataModelSubscription>>(
      `${API_VERSION}/subscriptions`,
      params?.filter,
    );
  }

  getSubscription(subscriptionNameOrId: string) {
    return this.get<DataModelSubscription>(
      `${API_VERSION}/subscriptions/${subscriptionNameOrId}`,
      undefined,
      { ignore404: true },
    );
  }

  replaceSubscription(
    subscriptionNameOrId: string,
    subscription: DataModelSubscriptionInput,
  ) {
    return this.put<DataModelSubscription>(
      `${API_VERSION}/subscriptions/${subscriptionNameOrId}`,
      subscription,
    );
  }

  async deleteSubscription(subscriptionNameOrId: string) {
    await this.delete(`${API_VERSION}/subscriptions/${subscriptionNameOrId}`);
  }

  subscriptionStart(subscriptionNameOrId: string) {
    return this.post(
      `${API_VERSION}/subscriptions/${subscriptionNameOrId}/start`,
      {},
    );
  }

  subscriptionStop(subscriptionNameOrId: string) {
    return this.post(
      `${API_VERSION}/subscriptions/${subscriptionNameOrId}/stop`,
      {},
    );
  }

  subscriptionReset(
    subscriptionNameOrId: string,
    request: SubscriptionResetRequest,
  ) {
    return this.post(
      `${API_VERSION}/subscriptions/${subscriptionNameOrId}/reset`,
      request,
    );
  }

  // Data Model Listeners
  getDataModelListeners(params?: { filter?: any }) {
    return this.get<ItemsResult<DataModelListener>>(
      `${API_VERSION}/listeners/datamodel`,
      params?.filter,
    );
  }

  getDataModelListener(listenerNameOrId: string) {
    return this.get<DataModelListener>(
      `${API_VERSION}/listeners/datamodel/${listenerNameOrId}`,
      undefined,
      { ignore404: true },
    );
  }

  replaceDataModelListener(
    listenerNameOrId: string,
    listener: DataModelListenerInput,
  ) {
    return this.put<DataModelListener>(
      `${API_VERSION}/listeners/datamodel/${listenerNameOrId}`,
      listener,
    );
  }

  async deleteDataModelListener(listenerNameOrId: string) {
    await this.delete(`${API_VERSION}/listeners/datamodel/${listenerNameOrId}`);
  }

  dataModelListenerStart(listenerNameOrId: string) {
    return this.post(
      `${API_VERSION}/listeners/datamodel/${listenerNameOrId}/start`,
      {},
    );
  }

  dataModelListenerStop(listenerNameOrId: string) {
    return this.post(
      `${API_VERSION}/listeners/datamodel/${listenerNameOrId}/stop`,
      {},
    );
  }

  dataModelListenerReset(
    listenerNameOrId: string,
    request: DataModelListenerResetRequest,
  ) {
    return this.post(
      `${API_VERSION}/listeners/datamodel/${listenerNameOrId}/reset`,
      request,
    );
  }

  // FireFly Listeners
  getFireFlyListeners(params?: { filter?: any }) {
    return this.get<ItemsResult<FireFlyListener>>(
      `${API_VERSION}/listeners/firefly`,
      params?.filter,
    );
  }

  getFireFlyListener(listenerNameOrId: string) {
    return this.get<FireFlyListener>(
      `${API_VERSION}/listeners/firefly/${listenerNameOrId}`,
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
      `${API_VERSION}/listeners/firefly/${listenerNameOrId}`,
      listener,
    );
  }

  async deleteFireFlyListener(listenerNameOrId: string) {
    await this.delete(`${API_VERSION}/listeners/firefly/${listenerNameOrId}`);
  }

  fireflyListenerStart(listenerNameOrId: string) {
    return this.post(
      `${API_VERSION}/listeners/firefly/${listenerNameOrId}/start`,
      {},
    );
  }

  fireflyListenerStop(listenerNameOrId: string) {
    return this.post(
      `${API_VERSION}/listeners/firefly/${listenerNameOrId}/stop`,
      {},
    );
  }
}
