// ASCII Chart Rendering Utilities
// Uses block characters for high-resolution terminal charts

// Block characters for bar rendering (8 levels)
const BLOCKS = ['░', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const VERTICAL_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

// Heatmap intensity characters
const HEATMAP = ['░', '▒', '▓', '█'];

/**
 * Render a horizontal bar chart
 * @param value - Current value
 * @param max - Maximum value (for scaling)
 * @param width - Total width in characters
 * @param fillChar - Character for filled portion (default █)
 * @param emptyChar - Character for empty portion (default ░)
 * @returns Rendered bar string
 */
export function renderHorizontalBar(
  value: number,
  max: number,
  width: number,
  fillChar: string = '█',
  emptyChar: string = '░'
): string {
  if (max === 0) return emptyChar.repeat(width);

  const ratio = Math.min(value / max, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  return fillChar.repeat(filled) + emptyChar.repeat(empty);
}

/**
 * Render a horizontal bar with partial blocks for smoother appearance
 * @param value - Current value
 * @param max - Maximum value
 * @param width - Total width in characters
 * @returns Rendered bar with partial blocks
 */
export function renderSmoothBar(
  value: number,
  max: number,
  width: number
): string {
  if (max === 0) return '░'.repeat(width);

  const ratio = Math.min(value / max, 1);
  const exactWidth = ratio * width;
  const fullBlocks = Math.floor(exactWidth);
  const partial = exactWidth - fullBlocks;
  const partialIndex = Math.round(partial * (BLOCKS.length - 1));
  const empty = width - fullBlocks - (partialIndex > 0 ? 1 : 0);

  let bar = '█'.repeat(fullBlocks);
  if (partialIndex > 0) {
    bar += BLOCKS[partialIndex];
  }
  bar += '░'.repeat(Math.max(0, empty));

  return bar.slice(0, width);
}

/**
 * Render vertical bars for a series of values
 * @param values - Array of numeric values
 * @param height - Height of the chart in lines
 * @param width - Width per bar (including spacing)
 * @returns Array of strings (one per line, top to bottom)
 */
export function renderVerticalBars(
  values: number[],
  height: number,
  barWidth: number = 2,
  gap: number = 1
): string[] {
  if (values.length === 0) return new Array(height).fill('');

  const max = Math.max(...values, 1);
  const lines: string[] = [];

  for (let row = height - 1; row >= 0; row--) {
    let line = '';
    for (let i = 0; i < values.length; i++) {
      const normalizedHeight = (values[i] / max) * height;
      const blockLevel = normalizedHeight - row;

      if (blockLevel >= 1) {
        // Full block
        line += '█'.repeat(barWidth);
      } else if (blockLevel > 0) {
        // Partial block
        const idx = Math.round(blockLevel * (VERTICAL_BLOCKS.length - 1));
        line += VERTICAL_BLOCKS[idx].repeat(barWidth);
      } else {
        // Empty
        line += ' '.repeat(barWidth);
      }
      line += ' '.repeat(gap);
    }
    lines.push(line);
  }

  return lines;
}

/**
 * Render a sparkline (single-line mini chart)
 * @param values - Array of numeric values
 * @param width - Total width (will sample/interpolate if needed)
 * @returns Single line sparkline string
 */
export function renderSparkline(values: number[], width?: number): string {
  if (values.length === 0) return '';

  // Resample if width specified and different from values length
  let data = values;
  if (width && width !== values.length) {
    data = resample(values, width);
  }

  const max = Math.max(...data, 1);
  let spark = '';

  for (const v of data) {
    const idx = Math.round((v / max) * (VERTICAL_BLOCKS.length - 1));
    spark += VERTICAL_BLOCKS[idx];
  }

  return spark;
}

/**
 * Render a heatmap row (24 hours)
 * @param values - Array of values (one per hour, 24 total)
 * @returns Heatmap string
 */
export function renderHeatmap(values: number[]): string {
  if (values.length === 0) return '';

  const max = Math.max(...values, 1);
  let heat = '';

  for (const v of values) {
    const idx = Math.round((v / max) * (HEATMAP.length - 1));
    heat += HEATMAP[idx];
  }

  return heat;
}

/**
 * Render a percentage as a mini bar
 * @param percent - Value 0-100
 * @param width - Width in characters
 * @returns Formatted percentage with bar
 */
export function renderPercentBar(percent: number, width: number = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format a number with thousand separators
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Resample an array to a new length using linear interpolation
 */
function resample(values: number[], newLength: number): number[] {
  if (values.length === 0) return new Array(newLength).fill(0);
  if (values.length === 1) return new Array(newLength).fill(values[0]);

  const result: number[] = [];
  const step = (values.length - 1) / (newLength - 1);

  for (let i = 0; i < newLength; i++) {
    const pos = i * step;
    const low = Math.floor(pos);
    const high = Math.min(low + 1, values.length - 1);
    const frac = pos - low;
    result.push(values[low] * (1 - frac) + values[high] * frac);
  }

  return result;
}

/**
 * Create a box border string
 */
export function boxTop(width: number, title?: string): string {
  if (title) {
    const padding = width - title.length - 4;
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return '┌' + '─'.repeat(left) + ' ' + title + ' ' + '─'.repeat(right) + '┐';
  }
  return '┌' + '─'.repeat(width - 2) + '┐';
}

export function boxBottom(width: number): string {
  return '└' + '─'.repeat(width - 2) + '┘';
}

export function boxLine(content: string, width: number): string {
  const padding = width - content.length - 4;
  return '│ ' + content + ' '.repeat(Math.max(0, padding + 1)) + ' │';
}
