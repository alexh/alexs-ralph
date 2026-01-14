import blessed from 'blessed';

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
    screen.destroy();
    process.exit(0);
  });

  // Handle resize
  screen.on('resize', () => {
    screen.render();
  });

  return screen;
}
