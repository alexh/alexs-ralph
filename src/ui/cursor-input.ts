/**
 * CursorInput - A textbox wrapper with proper cursor support
 *
 * blessed's built-in textbox doesn't support left/right cursor movement.
 * This wrapper adds cursor position tracking and renders a visible cursor.
 */

import blessed from 'blessed';

// Global flag to track if any input is currently being edited
// Used to suppress global keyboard shortcuts while typing
let activeInputCount = 0;

export function isAnyInputActive(): boolean {
  return activeInputCount > 0;
}

export interface CursorInputOptions {
  parent: blessed.Widgets.Node;
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
  style?: any;
  value?: string;
}

export interface CursorInput {
  box: blessed.Widgets.BoxElement;
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
  cancel(): void;
  readInput(callback: () => void): void;
  on(event: string, handler: (...args: any[]) => void): void;
  key(keys: string[], handler: () => void): void;
}

export function createCursorInput(options: CursorInputOptions, screen: blessed.Widgets.Screen): CursorInput {
  let value = options.value || '';
  let cursorPos = value.length;
  let isEditing = false;
  let doneCallback: (() => void) | null = null;

  const box = blessed.box({
    parent: options.parent,
    top: options.top,
    left: options.left,
    width: options.width,
    height: options.height,
    border: 'line',
    style: options.style || { fg: 'white', bg: 'black', border: { fg: 'cyan' } },
    mouse: true,
    keyable: true,
    tags: true,
  } as any);

  function render(): void {
    if (!isEditing) {
      box.setContent(value || '{#666-fg}(empty){/}');
      return;
    }

    // Show text with cursor
    const before = value.slice(0, cursorPos);
    const cursor = value[cursorPos] || ' ';
    const after = value.slice(cursorPos + 1);

    // Use inverse video for cursor
    box.setContent(`${before}{inverse}${cursor}{/inverse}${after}`);
  }

  function handleKey(ch: string | undefined, key: any): void {
    if (!isEditing) return;

    if (key.name === 'escape') {
      stopEditing();
      return;
    }

    if (key.name === 'enter') {
      stopEditing();
      return;
    }

    if (key.name === 'left') {
      if (cursorPos > 0) {
        cursorPos--;
        render();
        screen.render();
      }
      return;
    }

    if (key.name === 'right') {
      if (cursorPos < value.length) {
        cursorPos++;
        render();
        screen.render();
      }
      return;
    }

    if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
      cursorPos = 0;
      render();
      screen.render();
      return;
    }

    if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
      cursorPos = value.length;
      render();
      screen.render();
      return;
    }

    if (key.name === 'backspace') {
      if (cursorPos > 0) {
        value = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
        cursorPos--;
        render();
        screen.render();
      }
      return;
    }

    if (key.name === 'delete') {
      if (cursorPos < value.length) {
        value = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
        render();
        screen.render();
      }
      return;
    }

    // Regular character input
    if (ch && !key.ctrl && !key.meta && ch.length === 1 && ch >= ' ') {
      value = value.slice(0, cursorPos) + ch + value.slice(cursorPos);
      cursorPos++;
      render();
      screen.render();
    }
  }

  function startEditing(): void {
    if (isEditing) return;
    isEditing = true;
    activeInputCount++;
    cursorPos = value.length; // Start at end
    screen.program.on('keypress', handleKey);
    render();
    screen.render();
  }

  function stopEditing(): void {
    if (!isEditing) return;
    isEditing = false;
    activeInputCount = Math.max(0, activeInputCount - 1);
    screen.program.removeListener('keypress', handleKey);
    render();
    screen.render();
    if (doneCallback) {
      const cb = doneCallback;
      doneCallback = null;
      cb();
    }
  }

  render();

  return {
    box,

    getValue(): string {
      return value;
    },

    setValue(newValue: string): void {
      value = newValue;
      cursorPos = Math.min(cursorPos, value.length);
      render();
    },

    focus(): void {
      box.focus();
    },

    cancel(): void {
      if (isEditing) {
        stopEditing();
      } else {
        // Match blessed behavior - throw if not editing
        throw new Error('done is not a function');
      }
    },

    readInput(callback: () => void): void {
      doneCallback = callback;
      startEditing();
    },

    on(event: string, handler: (...args: any[]) => void): void {
      box.on(event, handler);
    },

    key(keys: string[], handler: () => void): void {
      box.key(keys, handler);
    },
  };
}
