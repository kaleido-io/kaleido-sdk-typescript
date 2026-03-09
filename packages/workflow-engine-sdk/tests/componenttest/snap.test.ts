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

import { describe, it, beforeAll, afterAll, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  WorkflowEngineClient,
  ConfigLoader,
  newDirectedTransactionHandler,
  BasicStageDirector,
  InvocationMode,
  EvalResult,
  WSEvaluateTransaction,
  WithStageDirector,
  newLogger,
} from '../../src/index';
import { loadTestConfig } from './test-config';
import { fetchWithRetry } from './fetch-utils';

const logger = newLogger('SnapTest');

// Load test configuration using SDK's ConfigLoader (from file + env overrides)
const testConfig = loadTestConfig();
const FLOW_ENGINE_URL = testConfig.workflowEngine.url;

interface PlayingCard {
  description: string;
  suit: string;
  rank: string;
}

class SnapHandlerInput implements WithStageDirector {
  public stageDirector: BasicStageDirector;
  public suit: string;
  public rank: string;

  constructor(input: any) {
    this.stageDirector = new BasicStageDirector(
      input.action || 'set-trap',
      input.outputPath || '/output',
      input.nextStage || 'success',
      input.failureStage || 'fail'
    );
    this.suit = input.suit;
    this.rank = input.rank;
  }

  getStageDirector() {
    return this.stageDirector;
  }
}

const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
const ranks = ['ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king'];

function newDeck(): PlayingCard[] {
  const deck: PlayingCard[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        description: `${rank} of ${suit}`,
        suit,
        rank
      });
    }
  }
  return deck;
}

function shuffleDeck(deck: PlayingCard[]): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

describe('Snap Component Test', () => {
  let watcherClient: WorkflowEngineClient;
  let dealerClient: WorkflowEngineClient;
  const deck = newDeck();
  const trapsSet = new Map<string, boolean>();
  const createdWorkflows: string[] = [];
  const createdTransactions: string[] = [];
  const createdStreams: string[] = [];

  // Helper to get auth headers for REST API calls (extracted from SDK's client config)
  function getAuthHeaders(): Record<string, string> {
    const clientConfig = ConfigLoader.createClientConfig(testConfig, 'test-client');
    return clientConfig.options?.headers || {};
  }

  beforeAll(async () => {
    shuffleDeck(deck);

    logger.info('Starting Snap Component Test');
    logger.info(`Flow Engine URL: ${FLOW_ENGINE_URL}`);

    // Create watcher client using SDK's ConfigLoader
    const watcherConfig = ConfigLoader.createClientConfig(testConfig, 'provider1');
    logger.info(`WebSocket URL: ${watcherConfig.url}`);
    watcherClient = new WorkflowEngineClient(watcherConfig);

    const watcherActionMap = new Map();

    // Set trap action
    watcherActionMap.set('set-trap', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction: WSEvaluateTransaction, input: SnapHandlerInput) => {
        const cardTopic = `suit.${input.suit}.rank.${input.rank}`;
        return {
          result: EvalResult.COMPLETE,
          triggers: [{ topic: cardTopic }]
        };
      }
    });

    // Trap set action
    watcherActionMap.set('trap-set', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction: WSEvaluateTransaction, input: SnapHandlerInput) => {
        const cardTopic = `suit.${input.suit}.rank.${input.rank}`;
        logger.info(`Trap set: ${cardTopic}`);
        trapsSet.set(cardTopic, true);
        return {
          result: EvalResult.WAITING
        };
      }
    });

    // Trap fired action
    watcherActionMap.set('trap-fired', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction: WSEvaluateTransaction, input: SnapHandlerInput) => {
        expect(transaction.events?.length).toBeGreaterThanOrEqual(1);
        const snap = transaction.events![0];
        const cardPlayed: PlayingCard = typeof snap.data === 'string'
          ? JSON.parse(snap.data)
          : snap.data;

        expect(cardPlayed.suit).toBe(input.suit);
        expect(cardPlayed.rank).toBe(input.rank);

        return {
          result: EvalResult.COMPLETE,
          output: snap.data
        };
      }
    });

    const watcherHandler = newDirectedTransactionHandler('watcher', watcherActionMap);
    watcherClient.registerTransactionHandler('watcher', watcherHandler);

    await watcherClient.connect();
    logger.info('Watcher client connected');
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    logger.info('Cleaning up snap test');

    if (watcherClient) watcherClient.disconnect();
    if (dealerClient) dealerClient.disconnect();

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Cleanup created resources
    const authHeaders = getAuthHeaders();

    // Cleanup streams first
    for (const streamId of createdStreams) {
      try {
        await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/streams/${streamId}`, {
          method: 'DELETE',
          headers: authHeaders
        });
      } catch (error) {
        logger.warn(`Error deleting stream ${streamId}:`, error);
      }
    }

    // Cleanup workflows
    for (const workflowId of createdWorkflows) {
      try {
        await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/workflows/${workflowId}`, {
          method: 'DELETE',
          headers: authHeaders
        });
      } catch (error) {
        logger.warn(`Error deleting workflow ${workflowId}:`, error);
      }
    }

    logger.info('Cleanup complete');
  }, 60000); // 60 second timeout for cleanup

  it('should play snap game with triggers and event matching', async () => {
    // Load and submit workflow YAML
    const workflowYAML = fs.readFileSync(
      path.join(__dirname, 'workflows/snap.yaml'),
      'utf8'
    );
    // Add name and version with unique suffix to avoid conflicts (tests use unique names, not DB drop/recreate)
    const uniqueSuffix = Date.now();
    const workflowYAMLWithMeta = `name: snap-${uniqueSuffix}\nversion: "1.0"\n${workflowYAML}`;

    const authHeaders = getAuthHeaders();
    const flowResponse = await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-yaml',
        ...authHeaders
      },
      body: workflowYAMLWithMeta
    });

    if (!flowResponse.ok) {
      const errorText = await flowResponse.text();
      logger.error(`Failed to create workflow: ${flowResponse.status} ${flowResponse.statusText}`);
      logger.error(`Response: ${errorText}`);
    }
    expect(flowResponse.status).toBe(201);
    expect(flowResponse.ok).toBe(true);
    const workflow = await flowResponse.json() as any;
    createdWorkflows.push(workflow.id);
    logger.info(`Workflow created: ${workflow.id}`);

    // Give workflow engine time to fully initialize the workflow
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Setup workflows for all cards
    const transactions: any[] = [];
    for (const suit of suits) {
      for (const rank of ranks) {
        const txResponse = await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/transactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({
            workflowId: workflow.id,
            operation: 'play',
            input: { suit, rank }
          })
        });

        expect(txResponse.status).toBe(200);
        expect(txResponse.ok).toBe(true);
        const tx = await txResponse.json() as any;
        transactions.push(tx);
        createdTransactions.push(tx.id);
      }
    }

    logger.info(`Created ${transactions.length} trap transactions`);

    // Wait for all traps to be set
    const maxWaitForTraps = 60000;
    const trapStartTime = Date.now();

    while (trapsSet.size < deck.length && (Date.now() - trapStartTime) < maxWaitForTraps) {
      logger.info(`Traps set: ${trapsSet.size}/${deck.length}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    expect(trapsSet.size).toBe(deck.length);
    logger.info('All traps set, starting dealer');

    // Now start the dealer event source using SDK's ConfigLoader
    const dealerConfig = ConfigLoader.createClientConfig(testConfig, 'provider2');
    dealerClient = new WorkflowEngineClient(dealerConfig);

    let dealt = 0;
    const dealerEventSource = {
      name: () => 'dealer',
      init: async () => {
        logger.info('Dealer initialized');
      },
      close: () => {
        logger.info('Dealer closed');
      },
      eventSourcePoll: async (_config: any, result: any) => {
        const toDeal = Math.min(Math.floor(Math.random() * 9) + 1, deck.length - dealt);
        const dealSet = deck.slice(dealt, dealt + toDeal);

        if (dealSet.length === 0) {
          result.events = [];
          result.checkpoint = { dealt };
          return;
        }

        result.events = dealSet.map(card => ({
          idempotencyKey: `${card.suit}-${card.rank}-${Date.now()}-${Math.random()}`,
          topic: `suit.${card.suit}.rank.${card.rank}`,
          data: card
        }));

        dealt += toDeal;
        result.checkpoint = { dealt };

        logger.info(`Dealt ${toDeal} cards, total: ${dealt}/${deck.length}`);
      },
      eventSourceValidateConfig: async () => { },
      eventSourceDelete: async () => { }
    };

    dealerClient.registerEventSource('dealer', dealerEventSource as any);
    await dealerClient.connect();
    logger.info('Dealer client connected');

    // Give event source time to register with workflow engine before creating stream
    // The engine waits 5s for handler connections, so we need to ensure registration is complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create event stream
    const streamResponse = await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/streams/dealer`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({
        name: 'dealer',
        started: true,
        type: 'correlation_stream',
        listenerHandler: 'dealer',
        listenerHandlerProvider: 'provider2',
        config: { game: 'snap' }
      })
    });

    if (!streamResponse.ok) {
      const errorText = await streamResponse.text();
      logger.error(`Failed to create stream: ${streamResponse.status} ${streamResponse.statusText}`);
      logger.error(`Response: ${errorText}`);
    }
    expect(streamResponse.status).toBeGreaterThanOrEqual(200);
    expect(streamResponse.status).toBeLessThanOrEqual(201);
    expect(streamResponse.ok).toBe(true);
    const stream = await streamResponse.json() as any;
    createdStreams.push(stream.id);
    logger.info(`Stream created: ${stream.id}`);

    // Wait for all transactions to complete (reach snap stage)
    const maxWait = 120000;
    const startTime = Date.now();
    const completedTxns = new Set<string>();

    while (completedTxns.size < transactions.length && (Date.now() - startTime) < maxWait) {
      for (const tx of transactions) {
        if (completedTxns.has(tx.id)) continue;

        const txResponse = await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/transactions/${tx.id}`, {
          headers: authHeaders
        });

        if (txResponse.ok) {
          const txState = await txResponse.json() as any;
          if (txState.stage === 'snap' || txState.stage === 'fail') {
            completedTxns.add(tx.id);
            logger.info(`Transaction ${tx.id} completed in stage ${txState.stage} (${completedTxns.size}/${transactions.length})`);
          }
        }
      }

      if (completedTxns.size < transactions.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    expect(completedTxns.size).toBe(transactions.length);
    logger.info('All snap transactions completed successfully');
  }, 180000); // 3 minute timeout
});

