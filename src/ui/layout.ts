import blessed from 'blessed';
import { colors, TABS } from '../config.js';

export interface LayoutWidgets {
  header: blessed.Widgets.BoxElement;
  tabBar: blessed.Widgets.BoxElement;
  loopList: blessed.Widgets.ListElement;
  detailPane: blessed.Widgets.BoxElement;
  logBox: blessed.Widgets.Log;
  statusBar: blessed.Widgets.BoxElement;
  criteriaBox: blessed.Widgets.BoxElement;
}

export function createLayout(screen: blessed.Widgets.Screen): LayoutWidgets {
  // Header
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: '{bold}{#ff4fd8-fg}◆ ALEX{/} {#666666-fg}— Multi-Agent Loop Orchestrator{/}',
    tags: true,
    style: {
      fg: 'white',
      bg: 'black',
    },
    padding: {
      left: 1,
      top: 1,
    },
  });

  // Tab bar
  const tabBar = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    style: {
      fg: 'white',
      bg: 'black',
    },
    padding: {
      left: 1,
    },
  });
  updateTabs(tabBar, 0);

  // Loop list (left pane) - using 'any' to bypass strict typing issues with blessed
  const loopList = blessed.list({
    parent: screen,
    label: ' {bold}LOOPS{/bold} ',
    tags: true,
    top: 6,
    left: 0,
    width: '35%',
    height: '100%-9',
    keys: true,
    mouse: true,
    vi: true,
    border: 'line',
    scrollbar: {
      ch: '█',
    },
    style: {
      fg: 'white',
      bg: 'black',
      border: {
        fg: 'magenta',
      },
      selected: {
        fg: 'black',
        bg: 'magenta',
        bold: true,
      },
    },
    shadow: true,
  } as any);

  // Detail pane (right pane)
  const detailPane = blessed.box({
    parent: screen,
    label: ' {bold}DETAIL{/bold} ',
    tags: true,
    top: 6,
    left: '35%',
    width: '65%',
    height: '100%-9',
    border: 'line',
    style: {
      fg: 'white',
      bg: 'black',
      border: {
        fg: 'cyan',
      },
    },
    shadow: true,
    padding: {
      left: 1,
      right: 1,
      top: 1,
    },
  } as any);

  // Detail header (inside detail pane)
  blessed.box({
    parent: detailPane,
    top: 0,
    left: 0,
    width: '100%-2',
    height: 3,
    tags: true,
    content: '{#666666-fg}Select a loop to view details{/}',
    style: {
      fg: 'white',
      bg: 'black',
    },
  });

  // Acceptance criteria box
  const criteriaBox = blessed.box({
    parent: detailPane,
    label: ' {#9b5de5-fg}Acceptance Criteria{/} ',
    tags: true,
    top: 4,
    left: 0,
    width: '100%-2',
    height: 8,
    border: 'line',
    style: {
      fg: 'white',
      bg: 'black',
      border: {
        fg: 'magenta',
      },
    },
    padding: {
      left: 1,
    },
    content: '{#666666-fg}No criteria{/}',
  } as any);

  // Log box (transcript)
  const logBox = blessed.log({
    parent: detailPane,
    label: ' {#2de2e6-fg}Transcript{/} ',
    tags: true,
    top: 13,
    left: 0,
    width: '100%-2',
    height: '100%-16',
    border: 'line',
    style: {
      fg: 'white',
      bg: 'black',
      border: {
        fg: 'cyan',
      },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '█',
    },
    mouse: true,
    keys: true,
    vi: true,
  } as any);

  // Status bar
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    style: {
      fg: 'white',
      bg: 235, // dark gray
    },
    padding: {
      left: 1,
      top: 1,
    },
  } as any);

  const keybinds = [
    '{#ff4fd8-fg}[N]{/} New',
    '{#ff4fd8-fg}[P]{/} Pause',
    '{#ff4fd8-fg}[S]{/} Stop',
    '{#ff4fd8-fg}[I]{/} Intervene',
    '{#ff4fd8-fg}[Tab]{/} Switch',
    '{#ff4fd8-fg}[Q]{/} Quit',
  ];
  statusBar.setContent(keybinds.join('  '));

  return {
    header,
    tabBar,
    loopList,
    detailPane,
    logBox,
    statusBar,
    criteriaBox,
  };
}

export function updateTabs(tabBar: blessed.Widgets.BoxElement, activeIndex: number): void {
  const tabs = TABS.map((tab, i) => {
    if (i === activeIndex) {
      return `{#ff4fd8-fg}{bold} ◆ ${tab} {/bold}{/}`;
    }
    return `{#666666-fg} ${tab} {/}`;
  });
  tabBar.setContent(tabs.join('  '));
}
