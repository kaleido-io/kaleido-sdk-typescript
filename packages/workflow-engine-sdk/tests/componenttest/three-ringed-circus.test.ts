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
  PatchOpType,
  newLogger,
} from '../../src/index';
import { loadTestConfig } from './test-config';
import { fetchWithRetry } from './fetch-utils';

const logger = newLogger('ThreeRingedCircusTest');

// Load test configuration using SDK's ConfigLoader (from file + env overrides)
const testConfig = loadTestConfig();
const FLOW_ENGINE_URL = testConfig.workflowEngine.url;

class CircusInput implements WithStageDirector {
  public stageDirector: BasicStageDirector;
  public visitor: string;
  public circuits: number;

  constructor(input: any) {
    this.stageDirector = new BasicStageDirector(
      input.action || 'enter',
      input.outputPath || '/output',
      input.nextStage || 'exit',
      input.failureStage || 'fail'
    );
    this.visitor = input.visitor;
    this.circuits = input.circuits || 0;
  }

  getStageDirector() {
    return this.stageDirector;
  }
}

interface ActionOneConfigProfile {
  oneVisitExit?: boolean;
}

describe('Three-Ringed Circus Component Test', () => {
  let client: WorkflowEngineClient;
  const circuitsPerVisit = 3;
  const tents = ['acrobats', 'animals', 'cowboys'];
  const visitors = ['Terry Jones', 'John Cleese', 'Eric Idle', 'Graham Chapman', 'Michael Palin', 'Terry Gilliam'];
  const failLikelihood = 0.03;
  let failCount = 0;
  const createdWorkflows: string[] = [];
  const createdTransactions: string[] = [];

  // Helper to get auth headers for REST API calls (extracted from SDK's client config)
  function getAuthHeaders(): Record<string, string> {
    const clientConfig = ConfigLoader.createClientConfig(testConfig, 'test-client');
    return clientConfig.options?.headers || {};
  }

  beforeAll(async () => {
    logger.info('Starting Three-Ringed Circus Component Test');
    logger.info(`Flow Engine URL: ${FLOW_ENGINE_URL}`);

    // Use SDK's ConfigLoader to create client config (just like real users would)
    const clientConfig = ConfigLoader.createClientConfig(testConfig, 'pythons');
    logger.info(`WebSocket URL: ${clientConfig.url}`);

    client = new WorkflowEngineClient(clientConfig);

    const actionMap = new Map();

    // Enter action
    actionMap.set('enter', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction: WSEvaluateTransaction, input: CircusInput) => {
        if (Math.random() < failLikelihood) {
          failCount++;
          return {
            result: EvalResult.TRANSIENT_ERROR,
            error: new Error(`${input.visitor} gaff ${failCount}`)
          };
        }
        return {
          result: EvalResult.COMPLETE,
          extraUpdates: [
            { op: PatchOpType.ADD, path: '/circuits', value: 0 },
            { op: PatchOpType.ADD, path: '/visits', value: {} },
            { op: PatchOpType.ADD, path: '/visits/one', value: [] },
            { op: PatchOpType.ADD, path: '/visits/two', value: [] },
            { op: PatchOpType.ADD, path: '/visits/three', value: [] },
          ]
        };
      }
    });

    // Ring one action
    actionMap.set('one', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (transaction: WSEvaluateTransaction) => {
        // Check for config profile
        if (transaction.configProfile) {
          const configProfile: ActionOneConfigProfile = JSON.parse(
            typeof transaction.configProfile === 'string' ? transaction.configProfile : JSON.stringify(transaction.configProfile)
          );
          if (configProfile.oneVisitExit) {
            return {
              result: EvalResult.COMPLETE,
              customStage: 'exit',
              extraUpdates: [
                { op: PatchOpType.ADD, path: '/visits/one/-', value: new Date().toISOString() }
              ]
            };
          }
        }
        return {
          result: EvalResult.COMPLETE,
          extraUpdates: [
            { op: PatchOpType.ADD, path: '/visits/one/-', value: new Date().toISOString() }
          ]
        };
      }
    });

    // Ring two action
    actionMap.set('two', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async () => {
        return {
          result: EvalResult.COMPLETE,
          extraUpdates: [
            { op: PatchOpType.ADD, path: '/visits/two/-', value: new Date().toISOString() }
          ]
        };
      }
    });

    // Ring three action
    actionMap.set('three', {
      invocationMode: InvocationMode.PARALLEL,
      handler: async (_transaction: WSEvaluateTransaction, input: CircusInput) => {
        const newCircuits = input.circuits + 1;
        const newStage = newCircuits >= circuitsPerVisit ? 'exit' : 'one';

        return {
          result: EvalResult.COMPLETE,
          customStage: newStage,
          extraUpdates: [
            { op: PatchOpType.REPLACE, path: '/circuits', value: newCircuits },
            { op: PatchOpType.ADD, path: '/visits/three/-', value: new Date().toISOString() }
          ]
        };
      }
    });

    const handler = newDirectedTransactionHandler('handler1', actionMap);
    client.registerTransactionHandler('handler1', handler);

    await client.connect();
    logger.info('Client connected');
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    logger.info('Cleaning up component test');
    client.disconnect();

    // Cleanup created resources
    const authHeaders = getAuthHeaders();
    const workflowDeletePromises = createdWorkflows.map(async (workflowId) => {
      try {
        const response = await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/workflows/${workflowId}`, {
          method: 'DELETE',
          headers: authHeaders
        });
        if (!response.ok) {
          logger.warn(`Failed to delete workflow ${workflowId}: ${response.status}`);
        }
      } catch (error) {
        logger.warn(`Error deleting workflow ${workflowId}:`, error);
      }
    });

    await Promise.all([...workflowDeletePromises]);
    logger.info('Cleanup complete');
  }, 60000); // 60 second timeout for cleanup

  it('should process visitors through all three rings', async () => {
    // Load and submit workflow YAML
    const workflowYAML = fs.readFileSync(
      path.join(__dirname, 'workflows/three-ringed-circus.yaml'),
      'utf8'
    );
    // Add name and version with unique suffix to avoid conflicts (tests use unique names, not DB drop/recreate)
    const uniqueSuffix = Date.now();
    const workflowYAMLWithMeta = `name: three-ringed-circus-${uniqueSuffix}\nversion: "1.0"\n${workflowYAML}`;

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
      logger.error(`Error response: ${errorText}`);
      throw new Error(`Failed to create workflow: ${flowResponse.status} ${errorText}`);
    }

    const workflow = await flowResponse.json() as any;
    createdWorkflows.push(workflow.id);
    logger.info(`Workflow created: ${workflow.id}`);

    // Submit transactions for each tent and visitor
    const transactions: any[] = [];
    for (const tent of tents) {
      for (const visitor of visitors) {
        const txResponse = await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/transactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({
            workflowId: workflow.id,
            operation: 'visit',
            input: {
              ticketNumber: 1000 + transactions.length,
              visitor: visitor
            },
            labels: {
              tent: tent
            }
          })
        });

        expect(txResponse.status).toBe(200);
        expect(txResponse.ok).toBe(true);
        const tx = await txResponse.json() as any;
        transactions.push(tx);
        createdTransactions.push(tx.id);
      }
    }

    logger.info(`Submitted ${transactions.length} transactions`);

    // Wait for all transactions to complete
    const maxWait = 120000; // 2 minutes
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
          if (txState.stage === 'exit') {
            completedTxns.add(tx.id);
            logger.info(`Transaction ${tx.id} completed (${completedTxns.size}/${transactions.length})`);
          }
        }
      }

      if (completedTxns.size < transactions.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    expect(completedTxns.size).toBe(transactions.length);

    // Verify each transaction
    const tentsByVisitor: Record<string, Set<string>> = {};

    logger.info(`Checking ${transactions.length} transactions`);
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      logger.info(`Checking transaction ${tx.id}`);
      const txResponse = await fetchWithRetry(`${FLOW_ENGINE_URL}/api/v1/transactions/${tx.id}`, {
        headers: authHeaders
      });

      expect(txResponse.status).toBe(200);
      expect(txResponse.ok).toBe(true);
      const txState = await txResponse.json() as any;

      expect(txState.stage).toBe('exit');
      expect(txState.state.input.ticketNumber).toBe(1000 + i);
      expect(txState.state.circuits).toBe(circuitsPerVisit);
      expect(txState.state.visits.one).toHaveLength(circuitsPerVisit);
      expect(txState.state.visits.two).toHaveLength(circuitsPerVisit);
      expect(txState.state.visits.three).toHaveLength(circuitsPerVisit);

      const visitor = txState.state.input.visitor;
      const tent = txState.labels.tent;

      if (!tentsByVisitor[visitor]) {
        tentsByVisitor[visitor] = new Set();
      }
      expect(tentsByVisitor[visitor].has(tent)).toBe(false); // No duplicates
      tentsByVisitor[visitor].add(tent);
    }

    // Verify all visitors visited all tents
    for (const visitor of visitors) {
      for (const tent of tents) {
        expect(tentsByVisitor[visitor].has(tent)).toBe(true);
      }
    }

    logger.info('All transactions completed successfully');
  }, 180000); // 3 minute timeout
});

