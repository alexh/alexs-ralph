import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { InputManager, ManagedInput, createInputManager } from './input-manager.js';

// Mock input that tracks calls
function createMockInput(): ManagedInput & {
  focusCalls: number;
  cancelCalls: number;
  readInputCalls: number;
  readInputCallback: (() => void) | null;
  simulateCancelThrow: boolean;
} {
  return {
    focusCalls: 0,
    cancelCalls: 0,
    readInputCalls: 0,
    readInputCallback: null,
    simulateCancelThrow: false,

    focus() {
      this.focusCalls++;
    },
    cancel() {
      this.cancelCalls++;
      if (this.simulateCancelThrow) {
        throw new Error('done is not a function');
      }
    },
    readInput(callback: () => void) {
      this.readInputCalls++;
      this.readInputCallback = callback;
    },
  };
}

describe('InputManager', () => {
  let manager: InputManager<ReturnType<typeof createMockInput>>;
  let input1: ReturnType<typeof createMockInput>;
  let input2: ReturnType<typeof createMockInput>;

  beforeEach(() => {
    manager = createInputManager();
    input1 = createMockInput();
    input2 = createMockInput();
  });

  test('initially has no active input', () => {
    expect(manager.getActive()).toBeNull();
  });

  test('activate() focuses input and calls readInput', () => {
    manager.activate(input1);

    expect(input1.focusCalls).toBe(1);
    expect(input1.readInputCalls).toBe(1);
    expect(manager.getActive()).toBe(input1);
  });

  test('isActive() returns true for active input', () => {
    manager.activate(input1);

    expect(manager.isActive(input1)).toBe(true);
    expect(manager.isActive(input2)).toBe(false);
  });

  test('switching inputs cancels the previous one', () => {
    manager.activate(input1);
    manager.activate(input2);

    expect(input1.cancelCalls).toBe(1);
    expect(input2.focusCalls).toBe(1);
    expect(manager.getActive()).toBe(input2);
  });

  test('activating same input twice does not cancel', () => {
    manager.activate(input1);
    manager.activate(input1);

    expect(input1.cancelCalls).toBe(0);
    expect(input1.focusCalls).toBe(2);
  });

  test('cancel() crash is caught when switching inputs', () => {
    manager.activate(input1);
    input1.simulateCancelThrow = true;

    // Should not throw
    expect(() => manager.activate(input2)).not.toThrow();
    expect(manager.getActive()).toBe(input2);
  });

  test('deactivate() cancels active input', () => {
    manager.activate(input1);
    manager.deactivate();

    expect(input1.cancelCalls).toBe(1);
    expect(manager.getActive()).toBeNull();
  });

  test('deactivate() on empty manager does nothing', () => {
    expect(() => manager.deactivate()).not.toThrow();
    expect(manager.getActive()).toBeNull();
  });

  test('readInput callback clears active state', () => {
    manager.activate(input1);
    expect(manager.getActive()).toBe(input1);

    // Simulate input completion
    input1.readInputCallback?.();

    expect(manager.getActive()).toBeNull();
  });

  test('readInput callback only clears if still active', () => {
    manager.activate(input1);
    manager.activate(input2);

    // Old callback from input1 should not clear input2
    input1.readInputCallback?.();

    expect(manager.getActive()).toBe(input2);
  });
});

describe('InputManager callbacks', () => {
  test('calls onActivate when activating', () => {
    const onActivate = mock(() => {});
    const manager = createInputManager({ onActivate });
    const input = createMockInput();

    manager.activate(input);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(input);
  });

  test('calls onDeactivate when switching', () => {
    const onDeactivate = mock(() => {});
    const manager = createInputManager({ onDeactivate });
    const input1 = createMockInput();
    const input2 = createMockInput();

    manager.activate(input1);
    manager.activate(input2);

    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(onDeactivate).toHaveBeenCalledWith(input1);
  });

  test('calls onDeactivate when deactivating', () => {
    const onDeactivate = mock(() => {});
    const manager = createInputManager({ onDeactivate });
    const input = createMockInput();

    manager.activate(input);
    manager.deactivate();

    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(onDeactivate).toHaveBeenCalledWith(input);
  });
});
