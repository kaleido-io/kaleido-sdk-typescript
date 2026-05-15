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

import { describe, it, expect } from 'vitest';
import {
  shortPartyName,
  normalizeAddr,
  toBaseUnits,
  isCreate,
  isArchive,
  findHoldingView,
  extractTransferData,
  extractInstrumentId,
  extractIssuer,
  baseLabels,
} from './helpers.js';
import { makeEvent, holdingInterfaceView } from './test-helpers.js';
import type { HoldingView } from './types.js';

describe('helpers', () => {
  describe('shortPartyName', () => {
    it('extracts name before :: separator', () => {
      expect(shortPartyName('alice::1220abcdef')).toBe('alice');
    });

    it('returns empty string for null/undefined', () => {
      expect(shortPartyName(null)).toBe('');
      expect(shortPartyName(undefined)).toBe('');
    });

    it('returns full string when no :: separator', () => {
      expect(shortPartyName('alice')).toBe('alice');
    });
  });

  describe('normalizeAddr', () => {
    it('lowercases addresses', () => {
      expect(normalizeAddr('Alice::1220ABCDEF')).toBe('alice::1220abcdef');
    });
  });

  describe('toBaseUnits', () => {
    it('converts integer amounts (x 10^10)', () => {
      expect(toBaseUnits('1000')).toBe('10000000000000');
    });

    it('converts decimal amounts', () => {
      expect(toBaseUnits('33.1081975897')).toBe('331081975897');
    });

    it('converts smallest fractional unit', () => {
      expect(toBaseUnits('0.0000000001')).toBe('1');
    });

    it('handles zero', () => {
      expect(toBaseUnits('0')).toBe('0');
    });

    it('handles negative amounts', () => {
      expect(toBaseUnits('-100')).toBe('-1000000000000');
    });
  });

  describe('isCreate / isArchive', () => {
    it('isCreate returns true for created events', () => {
      expect(isCreate(makeEvent({ eventType: 'created' }))).toBe(true);
    });

    it('isCreate returns false for archived events', () => {
      expect(isCreate(makeEvent({ eventType: 'archived' }))).toBe(false);
    });

    it('isArchive returns true for archived events', () => {
      expect(isArchive(makeEvent({ eventType: 'archived' }))).toBe(true);
    });

    it('isArchive returns true for consuming exercises', () => {
      expect(isArchive(makeEvent({ eventType: 'exercised', consuming: true }))).toBe(true);
    });

    it('isArchive returns false for non-consuming exercises', () => {
      expect(isArchive(makeEvent({ eventType: 'exercised', consuming: false }))).toBe(false);
    });
  });

  describe('findHoldingView', () => {
    it('finds Holding interface view', () => {
      const event = makeEvent({
        interfaceViews: [holdingInterfaceView({ owner: 'alice::fp', amount: '100' })],
      });
      const iv = findHoldingView(event);
      expect(iv?.entityName).toBe('Holding');
    });

    it('returns undefined when no Holding view', () => {
      const event = makeEvent({ interfaceViews: [] });
      expect(findHoldingView(event)).toBeUndefined();
    });
  });

  describe('extractTransferData', () => {
    it('extracts from interface view', () => {
      const event = makeEvent({
        interfaceViews: [{
          interfaceId: 'abc:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
          packageId: 'abc', moduleName: 'M', entityName: 'E',
          viewValue: {
            transfer: { sender: 'alice::fp', receiver: 'bob::fp', amount: '50' },
          },
        }],
      });
      const td = extractTransferData(event);
      expect(td).toMatchObject({ sender: 'alice::fp', receiver: 'bob::fp', amount: '50' });
    });

    it('falls back to arguments.transfer', () => {
      const event = makeEvent({
        arguments: {
          transfer: { sender: 'alice::fp', receiver: 'bob::fp', amount: '10' },
        },
      });
      const td = extractTransferData(event);
      expect(td).toMatchObject({ sender: 'alice::fp', receiver: 'bob::fp', amount: '10' });
    });

    it('returns null when no transfer data', () => {
      expect(extractTransferData(makeEvent({}))).toBeNull();
    });
  });

  describe('extractInstrumentId / extractIssuer', () => {
    it('extracts id and admin from view', () => {
      const view: HoldingView = { owner: 'a', amount: '1', instrumentId: { id: 'TOK', admin: 'bank::fp' } };
      expect(extractInstrumentId(view)).toBe('TOK');
      expect(extractIssuer(view)).toBe('bank::fp');
    });

    it('defaults instrumentId to KLD', () => {
      const view: HoldingView = { owner: 'a', amount: '1' };
      expect(extractInstrumentId(view)).toBe('KLD');
    });

    it('defaults issuer to empty string', () => {
      const view: HoldingView = { owner: 'a', amount: '1' };
      expect(extractIssuer(view)).toBe('');
    });
  });

  describe('baseLabels', () => {
    it('builds standard label set', () => {
      expect(baseLabels('CIP-56', 'holding')).toEqual({
        chain: 'canton', standard: 'CIP-56', type: 'holding', spent: 'false',
      });
    });

    it('merges extra labels', () => {
      expect(baseLabels('CIP-56', 'holding', { owner: 'x' })).toMatchObject({ owner: 'x' });
    });
  });
});
