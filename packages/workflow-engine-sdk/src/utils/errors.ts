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

import axios, { AxiosError } from "axios";


export const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
}

export const formatError = (error: any): string => {
    let message: string;
    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError;
      const data: any = axiosErr.response?.data as any;
      const dataMessage = data.message || data.error || JSON.stringify(data);
      message = `${axiosErr.request?.method} ${axiosErr.request?.url} failed [${axiosErr?.status}] ${error.message}: ${dataMessage}`
    } else {
      message = error.message || (typeof error);
    }
    if (typeof error.stack == 'string') {
      message = message + '\n' + error.stack;
    }
    return message;

}