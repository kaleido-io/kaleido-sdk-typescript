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


import { WorkflowEngineRestClient, CreateTransactionRequest } from '@kaleido-io/workflow-engine-sdk';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  try {
    // Get the flow name from command line arguments
    const transactionPath = process.argv[2];

    if (!transactionPath) {
      console.error('Error: Please provide a transaction JSON file as an argument.');
      console.error('Usage: tsx post-transaction.ts <transaction>');
      process.exit(1);
    }

    // Import the transaction from the TypeScript file
    let transaction: CreateTransactionRequest;
    try {
        const transactionModule = await import(`../../${transactionPath}`);
        if (!transactionModule.transaction) {
            console.error(`Error: The file ${transactionPath} does not export a 'transaction' constant.`);
            process.exit(1);
        }
        transaction = transactionModule.transaction;
    } catch (error) {
        console.error(`Error importing transaction file at ${transactionPath}:`, error);
        process.exit(1);
    }

    console.log('Posting transaction:', JSON.stringify(transaction, null, 2));

    // Create the transaction engine REST client
    const client = new WorkflowEngineRestClient();

    // Post the transaction
    const response = await client.createTransaction(transaction);

    console.log('Transaction posted successfully!');
    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error posting transaction:', error);
    process.exit(1);
  }
}

main();
