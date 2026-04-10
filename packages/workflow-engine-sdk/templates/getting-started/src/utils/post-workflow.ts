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


import { WorkflowEngineRestClient, CreateWorkflowRequest } from '@kaleido-io/workflow-engine-sdk';
import dotenv from 'dotenv';

dotenv.config();
async function main() {
    try {
        // Get the flow name from command line arguments
        const workflowPath = process.argv[2];

        if (!workflowPath) {
            console.error('Error: Please provide a workflow TypeScript file as an argument.');
            console.error('Usage: tsx post-workflow.ts <workflow>');
            process.exit(1);
        }

        // Import the workflow from the TypeScript file
        let workflow: CreateWorkflowRequest;
        try {
            const workflowModule = await import(`../../${workflowPath}`);
            if (!workflowModule.flow) {
                console.error(`Error: The file ${workflowPath} does not export a 'flow' constant.`);
                process.exit(1);
            }
            workflow = workflowModule.flow;
        } catch (error) {
            console.error(`Error importing workflow file at ${workflowPath}:`, error);
            process.exit(1);
        }

        console.log('Posting workflow:', JSON.stringify(workflow, null, 2));

        // Create the workflow engine REST client
        const client = new WorkflowEngineRestClient();

        // Post the workflow
        const response = await client.createWorkflow(workflow);

        console.log('Workflow posted successfully!');
        console.log('Response:', JSON.stringify(response, null, 2));
    } catch (error) {
        console.error('Error posting workflow:', error);
        process.exit(1);
    }
}

main();
