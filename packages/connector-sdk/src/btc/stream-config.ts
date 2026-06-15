// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
