// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import type {
  ActivityEvent,
  DataModelSubscription,
} from "../src/asset-manager.interfaces.js";

export interface EventBatchDelivery {
  type: "event_batch";
  stream: string;
  batchNumber: number;
  events: ActivityEvent[];
}

export type SubscriptionCallback = (
  batch: EventBatchDelivery,
) => void | Promise<void>;

interface SubscriptionState {
  /** Live record from the store — read on each delivery so filter
   *  changes take effect immediately. */
  record: DataModelSubscription;
  callback?: SubscriptionCallback;
  status: "started" | "stopped";
  /** Highest event sequence already delivered. */
  cursor: number;
  /** Monotonic batch counter, incremented per delivered batch. */
  batchNumber: number;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * Topic-filter matching + per-subscription batch delivery.
 *
 * Wired up from the store: whenever an ActivityEvent is upserted, the
 * store calls `enqueueEvent`. `flushEvents` walks each subscription,
 * matches against its `topicFilter`, batches, and invokes the
 * registered callback.
 *
 * Two modes:
 *   - manual (default): callers explicitly call `flushEvents` to
 *     drive delivery. Test-friendly determinism.
 *   - auto: `enqueueEvent` schedules a microtask flush. For tests
 *     that want fire-and-forget semantics.
 */
export class EventBus {
  private subs = new Map<string, SubscriptionState>();
  private flushScheduled = false;

  constructor(
    private mode: "manual" | "auto" = "manual",
    /** Lookup an event by its store sequence. Used during replay. */
    private allEvents: () => readonly ActivityEvent[] = () => [],
  ) {}

  setMode(mode: "manual" | "auto"): void {
    this.mode = mode;
  }

  /** Idempotently register a subscription record. */
  upsertSubscription(record: DataModelSubscription): void {
    const key = record.name ?? record.id;
    if (!key) return;
    const existing = this.subs.get(key);
    if (existing) {
      existing.record = record;
      return;
    }
    this.subs.set(key, {
      record,
      status: record.status === "stopped" ? "stopped" : "started",
      cursor: 0,
      batchNumber: 0,
    });
  }

  removeSubscription(nameOrId: string): void {
    this.subs.delete(nameOrId);
  }

  start(nameOrId: string): void {
    const s = this.subs.get(nameOrId);
    if (!s) return;
    s.status = "started";
  }

  stop(nameOrId: string): void {
    const s = this.subs.get(nameOrId);
    if (!s) return;
    s.status = "stopped";
  }

  /**
   * Rewind a subscription to deliver events from `sequenceId` onward
   * on the next flush.
   */
  reset(nameOrId: string, sequenceId?: number): void {
    const s = this.subs.get(nameOrId);
    if (!s) return;
    s.cursor = Math.max(0, (sequenceId ?? 0) - 1);
  }

  /** Register a callback for a subscription. Returns an unsubscribe. */
  listen(nameOrId: string, callback: SubscriptionCallback): () => void {
    const s = this.subs.get(nameOrId);
    if (!s) {
      // Allow registering listeners before the subscription record
      // exists — useful in tests that haven't seeded the sub yet.
      // We stash a placeholder so the next upsertSubscription
      // installs the callback.
      this.subs.set(nameOrId, {
        record: { id: nameOrId, name: nameOrId },
        callback,
        status: "started",
        cursor: 0,
        batchNumber: 0,
      });
      return () => this.subs.delete(nameOrId);
    }
    s.callback = callback;
    return () => {
      const cur = this.subs.get(nameOrId);
      if (cur && cur.callback === callback) {
        cur.callback = undefined;
      }
    };
  }

  /**
   * Called by the store whenever an ActivityEvent is upserted. We
   * just trigger a flush — subscriptions read the current state of
   * `allEvents()` when they fire.
   */
  enqueueEvent(_event: ActivityEvent): void {
    if (this.mode === "auto" && !this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flushScheduled = false;
        // Errors from a callback in auto-mode are not awaited; they
        // would otherwise become unhandled rejections. We swallow
        // them here — tests that care should use manual mode.
        void this.flushEvents();
      });
    }
  }

  async flushEvents(): Promise<void> {
    const events = this.allEvents();
    if (events.length === 0) return;
    // Sort by sequence ascending so cursors advance linearly.
    const ordered = [...events].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
    );

    for (const [, sub] of this.subs) {
      if (sub.status !== "started") continue;
      if (!sub.callback) continue;
      const filter = compileTopicFilter(sub.record.topicFilter);
      const batchSize = sub.record.batchSize || DEFAULT_BATCH_SIZE;

      const pending: ActivityEvent[] = [];
      for (const e of ordered) {
        const seq = e.sequence ?? 0;
        if (seq <= sub.cursor) continue;
        if (!filter.test(e.topic ?? "")) {
          sub.cursor = seq;
          continue;
        }
        pending.push(e);
      }

      // Chunk pending into batches honoring batchSize.
      for (let i = 0; i < pending.length; i += batchSize) {
        const slice = pending.slice(i, i + batchSize);
        const batch: EventBatchDelivery = {
          type: "event_batch",
          stream: sub.record.name ?? sub.record.id,
          batchNumber: ++sub.batchNumber,
          events: slice,
        };
        await sub.callback(batch);
        // Advance cursor past everything in the batch.
        sub.cursor = slice[slice.length - 1].sequence ?? sub.cursor;
      }
    }
  }
}

interface CompiledFilter {
  test(topic: string): boolean;
}

function compileTopicFilter(pattern: string | undefined): CompiledFilter {
  if (!pattern) return { test: () => true };
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    // Malformed regex — match nothing rather than throw asynchronously.
    return { test: () => false };
  }
  return { test: (t) => re.test(t) };
}
