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
const config: any = yaml.load(fs.readFileSync(process.env.CONFIG_FILE ?? './config/provider-config.yaml', 'utf8'));

export const stream = {
    name: "revert-reporter-stream",
    description: "Listen for reverted events from the EVM connector and pass them to the revert reporter event processor",
    type: "event_stream",
    eventSource: {
        type: "handler",
        handler: {
            name: "evmTransactions",
            provider: config.revertReporter.connectorProvider,
            config: {
                abi: [
                    {
                        "inputs": [
                            {
                                "internalType": "address",
                                "name": "spender",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "allowance",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "needed",
                                "type": "uint256"
                            }
                        ],
                        "name": "ERC20InsufficientAllowance",
                        "type": "error"
                    },
                    {
                        "inputs": [
                            {
                                "internalType": "address",
                                "name": "sender",
                                "type": "address"
                            },
                            {
                                "internalType": "uint256",
                                "name": "balance",
                                "type": "uint256"
                            },
                            {
                                "internalType": "uint256",
                                "name": "needed",
                                "type": "uint256"
                            }
                        ],
                        "name": "ERC20InsufficientBalance",
                        "type": "error"
                    },
                    {
                        "inputs": [
                            {
                                "internalType": "address",
                                "name": "approver",
                                "type": "address"
                            }
                        ],
                        "name": "ERC20InvalidApprover",
                        "type": "error"
                    },
                    {
                        "inputs": [
                            {
                                "internalType": "address",
                                "name": "receiver",
                                "type": "address"
                            }
                        ],
                        "name": "ERC20InvalidReceiver",
                        "type": "error"
                    },
                    {
                        "inputs": [
                            {
                                "internalType": "address",
                                "name": "sender",
                                "type": "address"
                            }
                        ],
                        "name": "ERC20InvalidSender",
                        "type": "error"
                    },
                    {
                        "inputs": [
                            {
                                "internalType": "address",
                                "name": "spender",
                                "type": "address"
                            }
                        ],
                        "name": "ERC20InvalidSpender",
                        "type": "error"
                    },
                    {
                        "inputs": [],
                        "name": "EnforcedPause",
                        "type": "error"
                    },
                    {
                        "inputs": [],
                        "name": "ExpectedPause",
                        "type": "error"
                    },
                    {
                        "inputs": [
                            {
                                "internalType": "address",
                                "name": "owner",
                                "type": "address"
                            }
                        ],
                        "name": "OwnableInvalidOwner",
                        "type": "error"
                    },
                    {
                        "inputs": [
                            {
                                "internalType": "address",
                                "name": "account",
                                "type": "address"
                            }
                        ],
                        "name": "OwnableUnauthorizedAccount",
                        "type": "error"
                    }
                ],
                enableBlockTrace: true,
                // this block not required but includes extra info
                decodeConstructors: true,
                includeBinaryInput: true,
                includeBinaryLogs: true,
                includeInputs: true,
                includeLogsBloom: true,
                omitSolidityDef: false,
                // end
                fromBlock: "2500",
                traceFilters: [
                    {
                        addresses: config.revertReporter.addresses,
                        excludeTo: true
                    }
                ]
            }
        }
    },
    transform: {
        filter: {
            jsonata: "$boolean(data.receipt.status = \"0\") or $boolean(data.receipt.status = \"0x0\")"
        }
    },
    eventProcessor: {
        type: "handler",
        handler: {
            name: "revert-reporter",
            provider: config.name
        }
    }
}
