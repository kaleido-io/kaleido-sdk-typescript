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


import {
    CreateStreamRequest,
    WorkflowEngineRestClient
} from '@kaleido-io/workflow-engine-sdk';

import dotenv from 'dotenv';

dotenv.config();
async function main() {
    try {
        // Get the flow name from command line arguments
        const streamPath = process.argv[2];

        if (!streamPath) {
            console.error('Error: Please provide a stream TypeScript file as an argument.');
            console.error('Usage: tsx post-stream.ts <stream>');
            process.exit(1);
        }

        // Import the workflow from the TypeScript file
        let stream: CreateStreamRequest;
        try {
            const streamModule = await import(`../../${streamPath}`);
            if (!streamModule.stream) {
                console.error(`Error: The file ${streamPath} does not export a 'stream' constant.`);
                process.exit(1);
            }
            stream = streamModule.stream;
        } catch (error) {
            console.error(`Error importing stream file at ${streamPath}:`, error);
            process.exit(1);
        }

        console.log('Posting stream:', JSON.stringify(stream, null, 2));

        // Create the workflow engine REST client
        const client = new WorkflowEngineRestClient();

        // Post the workflow
        const response = await client.createStream(stream);

        console.log('Stream posted successfully!');
        console.log('Response:', JSON.stringify(response, null, 2));
    } catch (error) {
        console.error('Error posting stream:', error);
        process.exit(1);
    }
}

main();
