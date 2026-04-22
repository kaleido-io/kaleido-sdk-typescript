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

import yaml from 'js-yaml';
import fs from 'fs';

// read the config from the config.yaml file
const config: any = yaml.load(fs.readFileSync(process.env.CONFIG_FILE ?? 'config/provider-config.yaml', 'utf8'));


export const stream = {
    'name': 'event-echo-stream',
    'description': 'Listen for events from the custom event source and pass them to the echo event processor',
    eventSource: {
        type: 'handler',
        handler: {
            name: 'my-listener',
            provider: config.name,
            config: {
                'pollingInterval': '2s'
            },
        },
    },
    eventProcessor: {
        type: 'handler',
        handler: {
            name: 'echo',
            provider: config.name,
        },
    },
}