import { describe, test, expect, beforeEach, mock } from 'bun:test';

// We can't easily test the full createCursorInput since it requires blessed,
// but we can test the cursor logic in isolation.

describe('Cursor position logic', () => {
  // Simulating cursor position handling
  function insertAt(value: string, pos: number, char: string): { value: string; pos: number } {
    return {
      value: value.slice(0, pos) + char + value.slice(pos),
      pos: pos + 1,
    };
  }

  function deleteAt(value: string, pos: number): { value: string; pos: number } {
    if (pos > 0) {
      return {
        value: value.slice(0, pos - 1) + value.slice(pos),
        pos: pos - 1,
      };
    }
    return { value, pos };
  }

  function moveLeft(pos: number): number {
    return Math.max(0, pos - 1);
  }

  function moveRight(pos: number, len: number): number {
    return Math.min(len, pos + 1);
  }

  test('insert at end', () => {
    const result = insertAt('hello', 5, '!');
    expect(result.value).toBe('hello!');
    expect(result.pos).toBe(6);
  });

  test('insert at beginning', () => {
    const result = insertAt('world', 0, 'H');
    expect(result.value).toBe('Hworld');
    expect(result.pos).toBe(1);
  });

  test('insert in middle', () => {
    const result = insertAt('helo', 3, 'l');
    expect(result.value).toBe('hello');
    expect(result.pos).toBe(4);
  });

  test('delete at end', () => {
    const result = deleteAt('hello', 5);
    expect(result.value).toBe('hell');
    expect(result.pos).toBe(4);
  });

  test('delete at beginning does nothing', () => {
    const result = deleteAt('hello', 0);
    expect(result.value).toBe('hello');
    expect(result.pos).toBe(0);
  });

  test('delete in middle', () => {
    const result = deleteAt('helllo', 4);
    expect(result.value).toBe('hello');
    expect(result.pos).toBe(3);
  });

  test('move left from middle', () => {
    expect(moveLeft(3)).toBe(2);
  });

  test('move left from start stays at 0', () => {
    expect(moveLeft(0)).toBe(0);
  });

  test('move right from middle', () => {
    expect(moveRight(3, 5)).toBe(4);
  });

  test('move right at end stays at end', () => {
    expect(moveRight(5, 5)).toBe(5);
  });
});

describe('Cursor rendering logic', () => {
  function renderWithCursor(value: string, cursorPos: number): string {
    const before = value.slice(0, cursorPos);
    const cursor = value[cursorPos] || ' ';
    const after = value.slice(cursorPos + 1);
    return `${before}[${cursor}]${after}`;
  }

  test('cursor at end shows space', () => {
    expect(renderWithCursor('hello', 5)).toBe('hello[ ]');
  });

  test('cursor at start', () => {
    expect(renderWithCursor('hello', 0)).toBe('[h]ello');
  });

  test('cursor in middle', () => {
    expect(renderWithCursor('hello', 2)).toBe('he[l]lo');
  });

  test('empty string shows cursor', () => {
    expect(renderWithCursor('', 0)).toBe('[ ]');
  });
});

describe('Paste simulation', () => {
  function pasteAt(value: string, pos: number, text: string): { value: string; pos: number } {
    return {
      value: value.slice(0, pos) + text + value.slice(pos),
      pos: pos + text.length,
    };
  }

  test('paste URL at empty input', () => {
    const result = pasteAt('', 0, 'https://github.com/user/repo');
    expect(result.value).toBe('https://github.com/user/repo');
    expect(result.pos).toBe(28);
  });

  test('paste at middle of existing text', () => {
    const result = pasteAt('hello world', 6, 'beautiful ');
    expect(result.value).toBe('hello beautiful world');
    expect(result.pos).toBe(16);
  });
});
