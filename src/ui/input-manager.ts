/**
 * Input Manager - Handles switching between textbox inputs safely
 *
 * blessed textboxes crash if you call cancel() when not in input mode.
 * This module tracks the active input and handles switching safely.
 */

export interface ManagedInput {
  focus(): void;
  cancel(): void;
  readInput(callback: () => void): void;
}

export interface InputManagerOptions {
  onActivate?: (input: ManagedInput) => void;
  onDeactivate?: (input: ManagedInput) => void;
}

export class InputManager<T extends ManagedInput> {
  private activeInput: T | null = null;
  private options: InputManagerOptions;

  constructor(options: InputManagerOptions = {}) {
    this.options = options;
  }

  /**
   * Get the currently active input, or null if none
   */
  getActive(): T | null {
    return this.activeInput;
  }

  /**
   * Safely activate an input, deactivating any currently active one first
   */
  activate(input: T): void {
    // Deactivate current if different
    if (this.activeInput && this.activeInput !== input) {
      this.safeCancel(this.activeInput);
      this.options.onDeactivate?.(this.activeInput);
    }

    this.activeInput = input;
    input.focus();
    input.readInput(() => {
      // Clear active state when input completes/cancels
      if (this.activeInput === input) {
        this.activeInput = null;
      }
    });
    this.options.onActivate?.(input);
  }

  /**
   * Deactivate the currently active input (if any)
   */
  deactivate(): void {
    if (this.activeInput) {
      this.safeCancel(this.activeInput);
      this.options.onDeactivate?.(this.activeInput);
      this.activeInput = null;
    }
  }

  /**
   * Check if a specific input is currently active
   */
  isActive(input: T): boolean {
    return this.activeInput === input;
  }

  /**
   * Safely call cancel on an input, catching any errors
   */
  private safeCancel(input: T): void {
    try {
      input.cancel();
    } catch {
      // Input wasn't in input mode - this is fine
    }
  }
}

/**
 * Create a new InputManager instance
 */
export function createInputManager<T extends ManagedInput>(
  options?: InputManagerOptions
): InputManager<T> {
  return new InputManager<T>(options);
}
