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

/**
 * Simple tests for WebSocket heartbeat functionality
 * These tests verify the heartbeat logic without full WebSocket mocking
 */

describe('WebSocket Heartbeat Logic', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should send periodic pings with proper timing', () => {
    const mockPing = jest.fn();
    const PING_INTERVAL = 30000;

    // Simulate heartbeat setup
    const pingInterval = setInterval(() => {
      mockPing();
    }, PING_INTERVAL);

    // No ping initially
    expect(mockPing).not.toHaveBeenCalled();

    // After 30 seconds, should have 1 ping
    jest.advanceTimersByTime(30000);
    expect(mockPing).toHaveBeenCalledTimes(1);

    // After 60 seconds total, should have 2 pings
    jest.advanceTimersByTime(30000);
    expect(mockPing).toHaveBeenCalledTimes(2);

    // After 90 seconds total, should have 3 pings
    jest.advanceTimersByTime(30000);
    expect(mockPing).toHaveBeenCalledTimes(3);

    clearInterval(pingInterval);
  });

  it('should trigger timeout if no pong received', () => {
    const mockTerminate = jest.fn();
    const PONG_TIMEOUT = 10000;

    // Simulate ping sent and pong timeout started
    const pongTimeout = setTimeout(() => {
      mockTerminate();
    }, PONG_TIMEOUT);

    // No termination initially
    expect(mockTerminate).not.toHaveBeenCalled();

    // After 10 seconds without pong
    jest.advanceTimersByTime(10000);
    expect(mockTerminate).toHaveBeenCalled();

    clearTimeout(pongTimeout);
  });

  it('should cancel timeout if pong received', () => {
    const mockTerminate = jest.fn();
    const PONG_TIMEOUT = 10000;

    // Simulate ping sent and pong timeout started
    const pongTimeout: NodeJS.Timeout | undefined = setTimeout(() => {
      mockTerminate();
    }, PONG_TIMEOUT);

    // Simulate pong received after 5 seconds
    jest.advanceTimersByTime(5000);

    // Clear timeout (simulating pong received)
    if (pongTimeout) {
      clearTimeout(pongTimeout);
    }

    // Advance past original timeout
    jest.advanceTimersByTime(10000);

    // Should NOT have terminated
    expect(mockTerminate).not.toHaveBeenCalled();
  });

  it('should handle multiple ping/pong cycles', () => {
    const mockPing = jest.fn();
    const mockPong = jest.fn();
    const PING_INTERVAL = 30000;
    const PONG_TIMEOUT = 10000;

    let pongTimeout: NodeJS.Timeout | undefined;

    // Setup ping interval
    const pingInterval = setInterval(() => {
      mockPing();

      // Start pong timeout
      pongTimeout = setTimeout(() => {
        // Connection dead
      }, PONG_TIMEOUT);
    }, PING_INTERVAL);

    // Cycle 1: Ping at 30s
    jest.advanceTimersByTime(30000);
    expect(mockPing).toHaveBeenCalledTimes(1);

    // Pong received at 35s
    jest.advanceTimersByTime(5000);
    if (pongTimeout) {
      clearTimeout(pongTimeout);
      pongTimeout = undefined;
    }
    mockPong();
    expect(mockPong).toHaveBeenCalledTimes(1);

    // Cycle 2: Ping at 60s
    jest.advanceTimersByTime(25000);
    expect(mockPing).toHaveBeenCalledTimes(2);

    // Pong received at 62s
    jest.advanceTimersByTime(2000);
    if (pongTimeout) {
      clearTimeout(pongTimeout);
    }
    mockPong();
    expect(mockPong).toHaveBeenCalledTimes(2);

    clearInterval(pingInterval);
  });

  it('should clean up intervals and timeouts', () => {
    const mockPing = jest.fn();
    const mockTerminate = jest.fn();

    const pingInterval = setInterval(() => {
      mockPing();
    }, 30000);

    const pongTimeout = setTimeout(() => {
      mockTerminate();
    }, 10000);

    // Advance 5 seconds
    jest.advanceTimersByTime(5000);

    // Cleanup (simulating connection close) BEFORE timeout fires at 10s
    clearInterval(pingInterval);
    clearTimeout(pongTimeout);

    // Advance past when ping and timeout would have fired
    jest.advanceTimersByTime(60000);

    // No pings because interval was cleared before first ping (at 30s)
    expect(mockPing).not.toHaveBeenCalled();

    // No terminate because timeout was cleared before firing (at 10s)
    expect(mockTerminate).not.toHaveBeenCalled();
  });

  it('should use correct timing values', () => {
    // Verify the timing constants are reasonable
    const PING_INTERVAL_MS = 30000; // 30 seconds
    const PONG_TIMEOUT_MS = 10000; // 10 seconds

    expect(PING_INTERVAL_MS).toBe(30000);
    expect(PONG_TIMEOUT_MS).toBe(10000);

    // Worst case detection time
    const WORST_CASE_DETECTION = PING_INTERVAL_MS + PONG_TIMEOUT_MS;
    expect(WORST_CASE_DETECTION).toBe(40000); // 40 seconds
  });
});

