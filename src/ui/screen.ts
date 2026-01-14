import blessed from 'blessed';
import { isAnyInputActive } from './cursor-input.js';

export function createScreen(): blessed.Widgets.Screen {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Alex - Multi-Agent Loop Orchestrator',
    fullUnicode: true,
    autoPadding: true,
    warnings: false,
  });

  // Global key bindings
  screen.key(['q', 'C-c'], () => {
    if (isAnyInputActive()) return;
    screen.destroy();
    process.exit(0);
  });

  // Handle resize
  screen.on('resize', () => {
    screen.render();
  });

  return screen;
}
