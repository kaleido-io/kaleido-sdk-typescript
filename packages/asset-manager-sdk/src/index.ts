export {
  newLogger,
  setLoggerFactory,
  defaultLoggerFactory,
} from './log/logger.js';
export type { Logger, LoggerFactory } from './log/logger.js';

export type { SetupContext } from '@kaleido-io/core/context';

export { AssetManagerClient } from "./asset-manager.js";
export {
  BulkUpsertBuilder,
  BulkUpsertBuilderOptions,
  BulkUpsertInvalidRefError,
  DuplicateStrategy,
  IDataModelClient,
  IBulkQueryClient,
  IBulkUpsertClient,
} from "./bulk-upsert-builder.js";
export * from "./interfaces/index.js";
