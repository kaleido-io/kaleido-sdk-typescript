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


import provider from '../../provider.js';
export const flow = {
  "operations": [
    {
      "name": "play",
      "type": "asynchronous",
      "stage": "set-trap",
      "inputSchema": {
        "type": "object",
        "properties": {
          "suit": {
            "type": "string"
          },
          "rank": {
            "type": "string"
          }
        },
        "required": [
          "suit",
          "rank"
        ],
        "additionalProperties": false
      }
    }
  ],
  "stages": [
    {
      "name": "set-trap",
      "type": "pending",
      "handler": "watcher",
      "inputMap": {
        "jsonata": "{\n  \"action\": \"set-trap\",\n  \"nextStage\": \"trap-set\",\n  \"failureStage\": \"fail\",\n  \"suit\": state.input.suit,\n  \"rank\": state.input.rank\n}\n"
      }
    },
    {
      "name": "trap-set",
      "type": "pending",
      "handler": "watcher",
      "inputMap": {
        "jsonata": "{\n  \"action\": \"trap-set\",\n  \"nextStage\": \"success\",\n  \"failureStage\": \"fail\",\n  \"suit\": state.input.suit,\n  \"rank\": state.input.rank\n}\n"
      }
    },
    {
      "name": "snap",
      "type": "success"
    },
    {
      "name": "fail",
      "type": "failure"
    }
  ],
  "events": [
    {
      "name": "played",
      "topicMatch": "suit\\.(.*)\\.rank\\.(.*)",
      "handler": "watcher",
      "inputMap": {
        "jsonata": "{\n  \"action\": \"trap-fired\",\n  \"nextStage\": \"snap\",\n  \"failureStage\": \"fail\",\n  \"outputPath\": \"/data\",\n  \"suit\": state.input.suit,\n  \"rank\": state.input.rank\n}\n"
      }
    }
  ],
  "handlerBindings": {
    "watcher": {
      "provider": provider.name,
      "providerHandler": "snap-watcher"
    }
  }
}
