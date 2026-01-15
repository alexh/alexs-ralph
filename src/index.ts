#!/usr/bin/env bun
import fs from 'fs';
import path from 'path';
import blessed from 'blessed';
import { parseArgs, runConfigure, runClean, showHelp, shouldShowTutorial } from './cli.js';
import { runTutorial } from './tutorial.js';
import { runUninstallWizard } from './uninstall.js';
import { createScreen } from './ui/screen.js';
import { colors, MAX_ITERATIONS_DEFAULT, METRICS_TREND_DAYS, METRICS_TREND_WEEKS, METRICS_TOP_FAILURES, DATA_DIR, SCROLLING_TEXT_ENABLED } from './config.js';
import { statusColors, statusIcons } from './ui/theme.js';
import {
  Issue,
  Loop,
  LoopStatus,
  AppSettings,
  loadState,
  saveState,
  updateLoop,
  fetchIssue,
  closeIssue,
  updateIssueBody,
  applyAcceptanceCriteriaToIssueBody,
  createLoop,
  startLoop,
  pauseLoop,
  resumeLoop,
  resumePausedLoop,
  stopLoop,
  retryLoop,
  markLoopManualComplete,
  sendIntervention,
  loopEvents,
  appendLog,
  readRecentLogs,
  readLogs,
  tailLog,
  formatLogEntry,
  getLogPath,
  killAll,
  markOrphanedPausedLoops,
  discardPausedLoop,
  canResumeInSession,
  createReviewLoop,
  createFollowUpFromReview,
  getAlternateAgent,
  calculateMetrics,
  formatDuration as formatDurationMs,
  exportMetricsToJson,
  DashboardMetrics,
} from './core/index.js';
import { getAvailableAdapters, adapterEvents, AgentAdapter } from './adapters/index.js';
import { createInputManager, ManagedInput } from './ui/input-manager.js';
import { createCursorInput, isAnyInputActive } from './ui/cursor-input.js';
import { renderHorizontalBar, renderVerticalBars, renderHeatmap } from './ui/charts.js';

function main(): void {
  const screen = createScreen();

  // App state
  let state = loadState();

  // Mark any paused loops without active processes as from previous session
  const orphanedCount = markOrphanedPausedLoops();
  if (orphanedCount > 0) {
    state = loadState(); // Reload after marking
  }

  let selectedLoopId: string | null = state.loops[0]?.id || null;
  let logTailCleanup: (() => void) | null = null;
  let showHidden = false;

  // ═══════════════════════════════════════════════════════════════════════════
  // NEON LIGHT SHOW BACKGROUND
  // ═══════════════════════════════════════════════════════════════════════════
  const bgBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    tags: true,
    style: { bg: 'black' },
  } as any);

  const bgState = {
    start: Date.now(),
    pulses: [] as { x: number; y: number; strength: number; born: number; life: number; color: string }[],
    logFlash: 0,
    nextSparkAt: Date.now() + 1200,
  };
  const glowChars = ' .:-=+*#%@';
  const glowColors = ['#130815', '#1c0b2a', '#2a0f4f', '#2e1a7a', '#0f3a7a', '#0a5fb8', '#00a5d8', '#00f5d4', '#ff4fd8'];
  const pulseColors = ['#ff4fd8', '#2de2e6', '#00f5d4', '#ffbe0b'];

  function triggerBackgroundGlow(kind: 'log' | 'error' | 'system' = 'log'): void {
    const now = Date.now();
    const w = (screen.width as number) || 80;
    const h = (screen.height as number) || 24;
    if (w < 30 || h < 10) return;

    const color = kind === 'error' ? '#ff006e' : kind === 'system' ? '#ffbe0b' : pulseColors[Math.floor(Math.random() * pulseColors.length)];
    bgState.pulses.push({
      x: Math.random(),
      y: Math.random(),
      strength: kind === 'error' ? 0.6 : 0.4,  // Much gentler pulses
      born: now,
      life: kind === 'error' ? 1800 : 1200,
      color,
    });
    // Subtle flash, not overwhelming
    bgState.logFlash = Math.min(0.3, bgState.logFlash + 0.08);
    if (kind === 'error') {
      bgState.logFlash = Math.min(0.5, bgState.logFlash + 0.15);
      // No strobe - too intense
    }
  }

  function generateLightShow(): string {
    const now = Date.now();
    const t = (now - bgState.start) / 1000;
    const w = (screen.width as number) || 80;
    const h = (screen.height as number) || 24;
    const breath = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.45));
    bgState.logFlash *= 0.92;  // Slightly faster decay

    if (now >= bgState.nextSparkAt) {
      bgState.pulses.push({
        x: Math.random(),
        y: Math.random(),
        strength: 0.8 + Math.random() * 0.6,
        born: now,
        life: 1600 + Math.random() * 1400,
        color: pulseColors[Math.floor(Math.random() * pulseColors.length)],
      });
      bgState.nextSparkAt = now + 1000 + Math.random() * 2200;
    }

    const pulses = bgState.pulses.filter(p => now - p.born < p.life);
    bgState.pulses = pulses;
    let pattern = '';

    for (let y = 0; y < h; y++) {
      let line = '';
      const ny = y / h;
      for (let x = 0; x < w; x++) {
        const nx = x / w;
        const wave =
          Math.sin((nx * 10 + t * 1.2) + Math.cos(ny * 3 + t * 0.6)) * 0.5 +
          Math.sin((ny * 9 - t * 1.1) + Math.cos(nx * 4 - t * 0.4)) * 0.5;
        let intensity = (wave + 1) * 0.35 * breath;

        for (const pulse of pulses) {
          const dx = nx - pulse.x;
          const dy = (ny - pulse.y) * 1.3;
          const dist2 = dx * dx + dy * dy;
          const age = (now - pulse.born) / pulse.life;
          const falloff = Math.exp(-dist2 * 28);
          intensity += pulse.strength * (1 - age) * falloff;
        }

        intensity += bgState.logFlash * 0.15;  // Subtle flash effect
        intensity = Math.max(0, Math.min(1.0, intensity));

        const charIdx = Math.min(glowChars.length - 1, Math.floor(intensity * (glowChars.length - 1)));
        const hueSeed = Math.sin(nx * 4 + ny * 3 + t * 0.4) * 0.5 + 0.5;
        const baseColorIdx = Math.min(glowColors.length - 1, Math.floor(hueSeed * (glowColors.length - 1)));
        const colorIdx = Math.min(glowColors.length - 1, Math.floor((baseColorIdx + intensity * 3)));
        const char = glowChars[charIdx];
        const color = glowColors[colorIdx];
        line += char === ' ' ? ' ' : `{${color}-fg}${char}{/}`;
      }
      pattern += line + '\n';
    }
    return pattern;
  }

  bgBox.setContent(generateLightShow());
  setInterval(() => {
    bgBox.setContent(generateLightShow());
    screen.render();
  }, 120);

  const isHiddenLoop = (loop: Loop): boolean => loop.hidden === true;

  function getVisibleLoops(): Loop[] {
    return showHidden ? state.loops.filter(isHiddenLoop) : state.loops.filter(loop => !isHiddenLoop(loop));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED TAB BAR (ALEX | X running | X paused | X done | X error)
  // ═══════════════════════════════════════════════════════════════════════════
  const tabBar = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: { fg: 'white', bg: 'black', transparent: true },
  } as any);

  const tabDefs = [
    { label: 'ALEx', status: null, color: '#ff4fd8', icon: '◆' },
    { label: 'running', status: 'running', color: '#2de2e6', icon: '◇' },
    { label: 'paused', status: 'paused', color: '#ffbe0b', icon: '◇' },
    { label: 'done', status: 'completed', color: '#00f5d4', icon: '' },
    { label: 'error', status: 'error', color: '#ff006e', icon: '' },
  ] as const;

  let activeTabIndex = 0;

  const tabButtons = tabDefs.map((tab, index) => blessed.button({
    parent: tabBar,
    top: 0,
    left: 1,
    width: 10,
    height: 1,
    tags: true,
    mouse: true,
    keys: true,
    shrink: true,
    content: tab.label,
    style: {
      fg: '#666666',
      bg: 'black',
      focus: { fg: '#ff4fd8' },
      hover: { fg: '#ff4fd8' },
    },
  } as any));

  function getTabCounts(): Record<string, number> {
    const visibleLoops = getVisibleLoops();
    return {
      ALEx: visibleLoops.length,
      running: visibleLoops.filter(l => l.status === 'running').length,
      paused: visibleLoops.filter(l => l.status === 'paused').length,
      done: visibleLoops.filter(l => l.status === 'completed').length,
      error: visibleLoops.filter(l => l.status === 'error').length,
    };
  }

  function updateHeader(): void {
    updateTabBar();
  }

  function updateTabBar(): void {
    const counts = getTabCounts();
    let leftOffset = 1;
    tabButtons.forEach((button, index) => {
      const def = tabDefs[index];
      const label = def.label;
      const count = counts[label];
      const isActive = index === activeTabIndex;
      const icon = def.icon ? `${def.icon} ` : '';

      let content: string;
      if (label === 'ALEx') {
        content = isActive
          ? `{bold}{#000000-fg} ${icon}${label} {/}{/bold}`
          : `{${def.color}-fg} ${icon}${label} {/}`;
      } else {
        content = isActive
          ? `{bold}{#000000-fg} ${count} ${label} {/}{/bold}`
          : `{${def.color}-fg}${count}{/} ${label}`;
      }

      button.setContent(content);
      button.style.bg = isActive ? def.color : 'black';
      button.style.fg = isActive ? 'black' : '#666666';
      button.style.bold = isActive;

      const textLen = label === 'ALEx'
        ? `${icon}${label}`.length
        : `${count} ${label}`.length;
      const width = textLen + 2;
      button.width = width;
      button.left = leftOffset;
      leftOffset += width + 2;
    });
  }

  function getFilteredLoops(): Loop[] {
    const visibleLoops = getVisibleLoops();
    const filter = tabDefs[activeTabIndex].status;
    if (!filter) return visibleLoops;
    return visibleLoops.filter(loop => loop.status === filter);
  }

  function setActiveTab(index: number): void {
    if (index < 0 || index >= tabDefs.length) return;
    activeTabIndex = index;
    updateTabBar();
    updateLoopList();
    syncSelectionAfterFilter();
    screen.render();
  }

  tabButtons.forEach((button, index) => {
    button.on('press', () => setActiveTab(index));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ABOUT BUTTON (top right corner)
  // ═══════════════════════════════════════════════════════════════════════════
  const aboutButton = blessed.button({
    parent: tabBar,
    top: 0,
    right: 1,
    width: 3,
    height: 1,
    content: '{#666666-fg}?{/}',
    tags: true,
    mouse: true,
    keys: true,
    style: {
      fg: '#666666',
      bg: 'black',
      focus: { fg: '#ff4fd8' },
      hover: { fg: '#ff4fd8' },
    },
  } as any);

  aboutButton.on('press', () => showAboutModal());

  function showAboutModal(): void {
    // Read VERSION file
    let version = '0.0.0';
    try {
      version = fs.readFileSync(path.join(process.cwd(), 'VERSION'), 'utf-8').trim();
    } catch {}

    // Read alex.txt ASCII art
    let alexArt = '';
    try {
      const animDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'animations');
      alexArt = fs.readFileSync(path.join(animDir, 'alex.txt'), 'utf-8');
    } catch {}

    // Create fullscreen modal
    const modal = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      tags: true,
      keys: true,
      style: { fg: 'white', bg: 'black' },
    } as any);

    // Rainbow colors for lava lamp effect
    const rainbowColors = [
      '#ff0000', '#ff3300', '#ff6600', '#ff9900', '#ffcc00', '#ffff00',
      '#ccff00', '#99ff00', '#66ff00', '#33ff00', '#00ff00', '#00ff33',
      '#00ff66', '#00ff99', '#00ffcc', '#00ffff', '#00ccff', '#0099ff',
      '#0066ff', '#0033ff', '#0000ff', '#3300ff', '#6600ff', '#9900ff',
      '#cc00ff', '#ff00ff', '#ff00cc', '#ff0099', '#ff0066', '#ff0033',
    ];
    let tick = 0;

    // Render content with lava lamp animated alex.txt
    function renderContent(): void {
      const artLines = alexArt.split('\n');
      const w = (screen.width as number) || 80;
      const artWidth = artLines[0]?.length || 0;
      const leftPad = Math.max(0, Math.floor((w - artWidth) / 2));

      // Lava lamp: each line gets a different color offset that flows
      const coloredArt = artLines.map((line, lineIdx) => {
        const colorIdx = (tick + lineIdx * 2) % rainbowColors.length;
        const color = rainbowColors[colorIdx];
        return ' '.repeat(leftPad) + `{${color}-fg}${line}{/}`;
      }).join('\n');

      // Pulsing effect - sine wave from light to dark
      const pulse = Math.sin(tick * 0.4) * 0.5 + 0.5; // 0 to 1, faster

      // Pink pulse for "Alex Haynes"
      const pinkR = Math.round(80 + pulse * 175);
      const pinkG = Math.round(20 + pulse * 40);
      const pinkB = Math.round(80 + pulse * 136);
      const pinkPulse = `#${pinkR.toString(16).padStart(2, '0')}${pinkG.toString(16).padStart(2, '0')}${pinkB.toString(16).padStart(2, '0')}`;

      // Cyan pulse for "ALEx v{version}"
      const cyanR = Math.round(20 + pulse * 25);
      const cyanG = Math.round(80 + pulse * 146);
      const cyanB = Math.round(80 + pulse * 150);
      const cyanPulse = `#${cyanR.toString(16).padStart(2, '0')}${cyanG.toString(16).padStart(2, '0')}${cyanB.toString(16).padStart(2, '0')}`;

      // Build content
      const content = [
        '',
        '',
        `{center}{bold}{${cyanPulse}-fg}ALEx v${version}{/}{/bold}{/center}`,
        '',
        `{center}{${colors.pink}-fg}Another Loop Experience{/}{/center}`,
        `{center}{#eaeaea-fg}Digital Materials Inc - Freeware Program{/}{/center}`,
        `{center}{#eaeaea-fg}created by {/}{${pinkPulse}-fg}Alex Haynes{/}{/center}`,
        '',
        `{center}{#888888-fg}Made in Brooklyn, New York, USA{/}{/center}`,
        '',
        '',
        coloredArt,
        '',
        '',
        `{center}{#666666-fg}[Esc/Enter] Close{/}{/center}`,
      ].join('\n');

      modal.setContent(content);
      screen.render();
    }

    // Animate lava lamp flow (~150ms for smooth effect)
    const animInterval = setInterval(() => {
      tick++;
      renderContent();
    }, 150);

    renderContent();

    // Close handler bound to screen
    let aboutModalOpen = true;
    const closeModal = (): void => {
      if (!aboutModalOpen) return;
      aboutModalOpen = false;
      clearInterval(animInterval);
      modal.destroy();
      screen.render();
    };

    screen.key(['escape', 'enter', 'q'], closeModal);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP LIST
  // ═══════════════════════════════════════════════════════════════════════════
  const loopListWindow = blessed.list({
    parent: screen,
    label: ' {bold}{#ff4fd8-fg}◆ LOOPS{/} ',
    tags: true,
    top: 1,
    left: 1,
    width: '30%-2',
    height: '100%-3',
    keys: true,
    mouse: true,
    vi: true,
    border: 'line',
    scrollbar: { ch: '█', style: { bg: 'magenta' } },
    style: {
      fg: 'white',
      bg: 'black',
      transparent: true,
      border: { fg: 'magenta' },
      selected: { fg: 'white', bg: 'magenta', bold: true },
      label: { fg: 'magenta' },
    },
    shadow: true,
  } as any);

  let loopListData: Loop[] = [];
  let loopListScrollOffset = 0;
  const loopTitleMaxChars = 22;

  // Start loop list title scroll animation (if enabled)
  if (SCROLLING_TEXT_ENABLED) {
    setInterval(() => {
      loopListScrollOffset++;
      updateLoopList();
    }, 200);
  }

  function formatDuration(startedAt?: string, endedAt?: string): string {
    if (!startedAt) return '--';
    const endTime = endedAt ? new Date(endedAt).getTime() : Date.now();
    const ms = endTime - new Date(startedAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}h${mins % 60}m`;
  }

  function getLoopTimestamp(loop: Loop): number {
    // Use most recent action: endedAt if finished, otherwise startedAt, otherwise 0
    const ts = loop.endedAt || loop.startedAt;
    return ts ? new Date(ts).getTime() : 0;
  }

  function updateLoopList(): void {
    loopListWindow.setLabel(
      showHidden
        ? ' {bold}{#ffbe0b-fg}◆ HIDDEN LOOPS{/} '
        : ' {bold}{#ff4fd8-fg}◆ LOOPS{/} '
    );
    const visibleLoops = getVisibleLoops();
    const filteredLoops = getFilteredLoops();
    // Sort by most recent action (newest first)
    const sortedLoops = [...filteredLoops].sort((a, b) => getLoopTimestamp(b) - getLoopTimestamp(a));
    loopListData = sortedLoops;
    if (visibleLoops.length === 0) {
      const emptyMessage = state.loops.length === 0
        ? '{#666-fg}No loops yet. Press [N] to create one.{/}'
        : showHidden
          ? '{#666-fg}No hidden loops.{/}'
          : '{#666-fg}No visible loops. Press [h] to show hidden.{/}';
      loopListWindow.setItems([emptyMessage]);
      return;
    }
    if (sortedLoops.length === 0) {
      const emptyLabel = tabDefs[activeTabIndex].label.toLowerCase();
      const message = emptyLabel === 'all' ? 'No loops.' : `No ${emptyLabel} loops.`;
      loopListWindow.setItems([`{#666-fg}${message}{/}`]);
      return;
    }
    const items = sortedLoops.map((loop) => {
      const icon = statusIcons[loop.status] || '?';
      const color = loop.hidden ? '#666666' : (statusColors[loop.status] || colors.text);
      const time = formatDuration(loop.startedAt, loop.endedAt);
      const prefixMap: Record<string, string> = { claude: 'CLA', codex: 'CDX', gemini: 'GEM' };
      const prefix = prefixMap[loop.agent] || loop.agent.substring(0, 3).toUpperCase();
      const rawTitle = loop.issue.title;
      let title: string;
      if (rawTitle.length <= loopTitleMaxChars) {
        title = rawTitle;
      } else if (SCROLLING_TEXT_ENABLED) {
        // Scrolling text for long titles
        const paddedTitle = rawTitle + '     ' + rawTitle;
        const offset = loopListScrollOffset % (rawTitle.length + 5);
        title = paddedTitle.slice(offset, offset + loopTitleMaxChars);
      } else {
        title = rawTitle.substring(0, loopTitleMaxChars) + '...';
      }
      // Show indicator for paused loops from previous session
      const prevSess = loop.pausedFromPreviousSession ? ' {#ffbe0b-fg}◀prev{/}' : '';
      const hiddenTag = loop.hidden ? ' {#666-fg}[hidden]{/}' : '';
      const titleColor = loop.hidden ? '666666' : 'ffffff';
      return ` {${color}-fg}${icon}{/} {#${titleColor}-fg}{bold}${prefix} #${loop.issue.number}{/} ${title}{/}${prevSess}${hiddenTag} {#666-fg}${time}{/}`;
    });
    loopListWindow.setItems(items);
  }

  function applyLoopUpdate(loopId: string, updates: Partial<Loop>): Loop | undefined {
    let nextState = loadState();
    nextState = updateLoop(nextState, loopId, updates);
    saveState(nextState);
    state = nextState;
    return state.loops.find(l => l.id === loopId);
  }

  function refreshAfterVisibilityChange(): void {
    updateLoopList();
    updateHeader();
    updateTabBar();
    const selectionChanged = syncSelectionAfterFilter();
    if (!selectionChanged) {
      const currentLoop = selectedLoopId ? state.loops.find(l => l.id === selectedLoopId) : undefined;
      if (currentLoop) {
        updateDetailPane(currentLoop);
        updateStatusBar(currentLoop);
      } else {
        updateStatusBar();
      }
    }
    screen.render();
  }

  function syncSelectionAfterFilter(): boolean {
    if (loopListData.length === 0) {
      if (selectedLoopId !== null) {
        selectedLoopId = null;
        detailWindow.setContent('{#666-fg}No loops match this filter.{/}');
        updateStatusBar();
        if (logTailCleanup) {
          logTailCleanup();
          logTailCleanup = null;
        }
        logWindow.setContent('');
      }
      return true;
    }

    const selectedIndex = loopListData.findIndex(loop => loop.id === selectedLoopId);
    if (selectedIndex >= 0) {
      loopListWindow.select(selectedIndex);
      return false;
    }

    selectedLoopId = loopListData[0].id;
    loopListWindow.select(0);
    updateDetailPane(loopListData[0]);
    updateStatusBar(loopListData[0]);
    loadLogsForLoop(loopListData[0].id);
    return true;
  }
  updateLoopList();
  updateTabBar();

  // ═══════════════════════════════════════════════════════════════════════════
  // DETAIL PANE
  // ═══════════════════════════════════════════════════════════════════════════
  const detailWindow = blessed.box({
    parent: screen,
    label: ' {bold}{#2de2e6-fg}◆ LOOP DETAIL{/} ',
    tags: true,
    top: 1,
    left: '30%',
    width: '70%-1',
    height: '50%-1',
    border: 'line',
    style: {
      fg: 'white',
      bg: 'black',
      transparent: true,
      border: { fg: 'cyan' },
      label: { fg: 'cyan' },
    },
    shadow: true,
    padding: { left: 1, top: 0 },
    content: '{#666-fg}No loop selected. Press [N] to create one.{/}',
    mouse: true,
  } as any);

  const criteriaList = blessed.list({
    parent: detailWindow,
    top: 5,
    left: 1,
    width: '100%-4',
    height: 8,
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    style: {
      fg: 'white',
      bg: 'black',
      selected: { fg: 'white', bg: 'magenta', bold: true },
    },
    scrollbar: { ch: '█', style: { bg: 'magenta' } },
  } as any);


  const runningSymbols = ['·', '✻', '✽', '✶', '✳', '✢', '✦', '✧', '✵', '✸', '✹', '✺'];
  let runningSymbolIndex = 0;
  let runningSymbol = runningSymbols[0];

  function updateDetailPane(loop: Loop): void {
    const statusColor = statusColors[loop.status] || colors.text;
    const statusIcon = loop.status === 'running'
      ? runningSymbol
      : (statusIcons[loop.status] || '?');
    const hiddenIndicator = loop.hidden ? ' {#666-fg}[hidden]{/}' : '';
    const time = formatDuration(loop.startedAt, loop.endedAt);
    const maxIterations = loop.maxIterations ?? MAX_ITERATIONS_DEFAULT;
    const iteration = loop.iteration ?? 0;
    const issueStatus = loop.issueClosed ? ' {#00f5d4-fg}✓ closed{/}' : '';

    // Show indicator for paused loops from previous session
    const prevSessionIndicator = loop.pausedFromPreviousSession
      ? ' {#ffbe0b-fg}◀ PREVIOUS SESSION{/}'
      : '';
    const pausedAtInfo = loop.pausedAt && loop.status === 'paused'
      ? `  {#666-fg}│{/}  {#9b5de5-fg}Paused:{/} ${new Date(loop.pausedAt).toLocaleString()}`
      : '';

    // Review workflow indicators
    const reviewIndicator = loop.isReviewLoop
      ? ' {#ff4fd8-fg}◆ REVIEW{/}'
      : '';
    const worktreeIndicator = loop.worktreePath
      ? `  {#666-fg}│{/}  {#9b5de5-fg}Worktree:{/} ${loop.worktreeBranch || 'active'}`
      : '';

    const logPath = getLogPath(loop.id);
    let content =
      `{bold}{#fff-fg}${loop.issue.title}{/}{/bold}\n` +
      `{#666-fg}─────────────────────────────────────────────────────{/}\n` +
      `{${statusColor}-fg}${statusIcon} ${loop.status.toUpperCase()}{/}${hiddenIndicator}${prevSessionIndicator}${reviewIndicator}  {#666-fg}│{/}  ` +
      `{#9b5de5-fg}Agent:{/} ${loop.agent}  {#666-fg}│{/}  ` +
      `{#9b5de5-fg}Time:{/} ${time}  {#666-fg}│{/}  ` +
      `{#9b5de5-fg}Iteration{/} ${iteration}/${maxIterations}  {#666-fg}│{/}  ` +
      `{#9b5de5-fg}Issue:{/} #${loop.issue.number}${issueStatus}${pausedAtInfo}${worktreeIndicator}\n` +
      `{#9b5de5-fg}Log:{/} ${logPath}\n`;

    // Show review links
    if (loop.reviewLoopId) {
      const reviewLoop = state.loops.find(l => l.id === loop.reviewLoopId);
      const reviewStatus = reviewLoop?.status || 'unknown';
      const reviewStatusColor = statusColors[reviewStatus as LoopStatus] || '#666';
      content += `{#ff4fd8-fg}Review:{/} {${reviewStatusColor}-fg}${reviewStatus}{/} {#666-fg}(V to view){/}\n`;
    }
    if (loop.parentLoopId) {
      const parentLoop = state.loops.find(l => l.id === loop.parentLoopId);
      content += `{#ff4fd8-fg}Reviewing:{/} ${parentLoop?.issue.title || loop.parentLoopId} {#666-fg}(V to view original){/}\n`;
    }
    content += '\n';

    content += `{#ffbe0b-fg}━━━ Acceptance Criteria ━━━{/}\n`;

    const agentColor = '#2de2e6';
    const operatorColor = '#0a5fb8';
    const items = loop.issue.acceptanceCriteria.length > 0
      ? loop.issue.acceptanceCriteria.map((criterion) => {
        const iconColor = criterion.completed
          ? (criterion.completedBy === 'agent' ? agentColor : operatorColor)
          : '#666';
        const icon = criterion.completed ? '✓' : '○';
        return ` {${iconColor}-fg}${icon}{/} ${criterion.text}`;
      })
      : ['{#666-fg}No acceptance criteria{/}'];
    criteriaList.setItems(items);
    // Keep criteria list height constrained to fit within detail pane
    criteriaList.height = Math.min(8, Math.max(2, items.length));

    if (loop.error) {
      content += `\n{#ff006e-fg}Error: ${loop.error}{/}`;
    }

    detailWindow.setContent(content);
  }

  function toggleCriterion(loopId: string, index: number): void {
    let nextState = loadState();
    const loop = nextState.loops.find(l => l.id === loopId);
    if (!loop) return;
    if (index < 0 || index >= loop.issue.acceptanceCriteria.length) return;

    const criterion = loop.issue.acceptanceCriteria[index];
    const nextCompleted = !criterion.completed;
    criterion.completed = nextCompleted;
    criterion.completedBy = nextCompleted ? 'operator' : undefined;
    criterion.completedAt = nextCompleted ? new Date().toISOString() : undefined;

    nextState = updateLoop(nextState, loopId, { issue: loop.issue });
    saveState(nextState);
    state = nextState;

    appendLog(loopId, {
      type: 'system',
      content: `Criterion ${index + 1} marked ${nextCompleted ? 'complete' : 'incomplete'} by operator`,
    });

    const updatedLoop = state.loops.find(l => l.id === loopId);
    if (updatedLoop) {
      updateDetailPane(updatedLoop);
      updateStatusBar(updatedLoop);
    }
    screen.render();
  }

  criteriaList.on('select', (_item: any, index: number) => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    toggleCriterion(selectedLoopId, index);
  });

  setInterval(() => {
    runningSymbolIndex = (runningSymbolIndex + 1) % runningSymbols.length;
    runningSymbol = runningSymbols[runningSymbolIndex];
    if (Math.random() < 0.2) {
      runningSymbol = runningSymbols[Math.floor(Math.random() * runningSymbols.length)];
    }
    if (selectedLoopId) {
      const loop = state.loops.find(l => l.id === selectedLoopId);
      if (loop?.status === 'running') {
        updateDetailPane(loop);
        screen.render();
      }
    }
  }, 160);

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSCRIPT LOG
  // ═══════════════════════════════════════════════════════════════════════════
  const logWindow = blessed.log({
    parent: screen,
    label: ' {bold}{#9b5de5-fg}◆ LIVE TRANSCRIPT{/} ',
    tags: true,
    top: '50%',
    left: '30%',
    width: '70%-1',
    height: '50%-1',
    keys: true,
    vi: true,
    border: 'line',
    style: {
      fg: 'white',
      bg: 'black',
      transparent: true,
      border: { fg: '#9b5de5' },
      label: { fg: '#9b5de5' },
    },
    shadow: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '█', style: { bg: 'magenta' } },
    mouse: true,
    padding: { left: 1 },
  } as any);

  let logViewer: blessed.Widgets.BoxElement | null = null;
  let logViewerLog: blessed.Widgets.Log | null = null;
  let logViewerCleanup: (() => void) | null = null;

  function buildFullLogContent(loopId: string): string {
    const entries = readLogs(loopId);
    if (entries.length === 0) {
      return '{#666-fg}No log entries yet.{/}';
    }
    return entries.map(entry => formatLogEntry(entry)).join('\n');
  }

  function closeLogViewer(): void {
    if (!logViewer) return;
    if (logViewerCleanup) {
      logViewerCleanup();
      logViewerCleanup = null;
    }
    logViewer.destroy();
    logViewerLog = null;
    logViewer = null;
    loopListWindow.focus();
    screen.render();
  }

  function openLogViewer(loop: Loop): void {
    if (logViewer) return;
    logViewer = blessed.box({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ FULL LOG{/} ',
      tags: true,
      top: 1,
      left: 2,
      width: '100%-4',
      height: '100%-4',
      border: 'line',
      keys: true,
      vi: true,
      mouse: true,
      style: {
        fg: 'white',
        bg: 'black',
        transparent: true,
        border: { fg: '#ff4fd8' },
        label: { fg: '#ff4fd8' },
      },
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
    } as any);

    logViewerLog = blessed.log({
      parent: logViewer,
      top: 1,
      left: 1,
      width: '100%-2',
      height: '100%-2',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: '█', style: { bg: 'magenta' } },
      style: {
        fg: 'white',
        bg: 'black',
        transparent: true,
      },
      padding: { left: 1, right: 1 },
      content: buildFullLogContent(loop.id),
    } as any);

    (logViewerLog as any)._clines = null;
    logViewerLog.setScroll(0);

    logViewerCleanup = tailLog(loop.id, (entry) => {
      if (!logViewerLog || !entry.content.trim()) return;
      logViewerLog.log(formatLogEntry(entry));
      screen.render();
    });

    logViewer.key(['escape', 'l', 'L', 'S-tab'], closeLogViewer);
    logViewerLog.key(['escape', 'l', 'L', 'S-tab'], closeLogViewer);
    logViewerLog.focus();
    screen.render();
  }

  function setActivePane(pane: blessed.Widgets.BoxElement | blessed.Widgets.ListElement | blessed.Widgets.Log): void {
    const activeBorder = { fg: '#00f5d4' };
    const inactiveBorder = { fg: 'magenta' };
    const activeLabel = { fg: '#00f5d4' };
    const inactiveLabel = { fg: 'magenta' };

    loopListWindow.style.border = pane === loopListWindow ? activeBorder : inactiveBorder;
    loopListWindow.style.label = pane === loopListWindow ? activeLabel : inactiveLabel;
    detailWindow.style.border = pane === detailWindow ? activeBorder : { fg: 'cyan' };
    detailWindow.style.label = pane === detailWindow ? activeLabel : { fg: 'cyan' };
    logWindow.style.border = pane === logWindow ? activeBorder : { fg: '#9b5de5' };
    logWindow.style.label = pane === logWindow ? activeLabel : { fg: '#9b5de5' };
  }

  loopListWindow.on('focus', () => {
    setActivePane(loopListWindow);
    screen.render();
  });
  detailWindow.on('focus', () => {
    setActivePane(detailWindow);
    screen.render();
  });
  criteriaList.on('focus', () => {
    setActivePane(detailWindow);
    screen.render();
  });
  logWindow.on('focus', () => {
    setActivePane(logWindow);
    screen.render();
  });
  setActivePane(loopListWindow);

  screen.key(['tab'], () => {
    if (isAnyInputActive()) return;
    const currentIndex = tabButtons.findIndex(button => screen.focused === button);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % tabButtons.length;
    tabButtons[nextIndex].focus();
    screen.render();
  });

  // Shift+Tab - Return focus to loop list (global "escape hatch")
  screen.key(['S-tab'], () => {
    // Close log viewer if open
    if (logViewer) {
      closeLogViewer();
    }
    // Focus loop list if not already focused
    if (screen.focused !== loopListWindow) {
      loopListWindow.focus();
      setActivePane(loopListWindow);
      screen.render();
    }
  });

  function logWithGlow(message: string, kind: 'log' | 'error' | 'system' = 'log'): void {
    logWindow.log(message);
    triggerBackgroundGlow(kind);
  }

  function loadLogsForLoop(loopId: string): void {
    // Cleanup previous tail
    if (logTailCleanup) {
      logTailCleanup();
      logTailCleanup = null;
    }

    // Clear log widget properly (blessed.log quirk)
    logWindow.setContent('');
    (logWindow as any)._clines = null;
    logWindow.setScroll(0);

    // Load recent logs
    const recentLogs = readRecentLogs(loopId, 50);
    for (const entry of recentLogs) {
      if (!entry.content.trim()) continue;
      logWindow.log(formatLogEntry(entry));
    }

    // Scroll to bottom and render
    logWindow.setScrollPerc(100);
    screen.render();

    // Start tailing
    logTailCleanup = tailLog(loopId, (entry) => {
      if (!entry.content.trim()) return;
      logWindow.log(formatLogEntry(entry));
      triggerBackgroundGlow(entry.type === 'error' ? 'error' : entry.type === 'system' ? 'system' : 'log');
      screen.render();
    });
  }

  logWithGlow('{#666-fg}[system]{/} Alex initialized. Press [N] to create a loop.', 'system');

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS BAR
  // ═══════════════════════════════════════════════════════════════════════════
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: { fg: 'white', bg: 'black' },
    content: '',
  } as any);

  // Ensure status bar stays on top
  statusBar.setFront();

  function updateStatusBar(loop?: Loop): void {
    const nav = '{#2de2e6-fg}↑↓{/}Nav';
    const quit = '{#ff4fd8-fg}[Q]{/}uit';
    const newLoop = '{#ff4fd8-fg}[N]{/}ew';
    const refresh = '{#ff4fd8-fg}[T]{/} Refresh';
    const viewLogs = '{#ff4fd8-fg}[L]{/} Logs';
    const metrics = '{#9b5de5-fg}[M]{/}etrics';
    const toggleHidden = showHidden
      ? '{#ffbe0b-fg}[H]{/} Show visible'
      : '{#ffbe0b-fg}[H]{/} Show hidden';
    const bulkHide = '{#ff4fd8-fg}[B]{/} Bulk hide';
    const hideAction = loop && !showHidden ? '{#ff4fd8-fg}[h]{/} Hide' : '';
    const unhideAction = loop && showHidden ? '{#ff4fd8-fg}[U]{/} Unhide' : '';
    const visibilityActions = `${hideAction}${unhideAction ? ` ${unhideAction}` : ''} ${bulkHide} ${toggleHidden}`.trim();

    let actions = '';
    if (!loop) {
      actions = `${newLoop} ${metrics} ${visibilityActions} {#666-fg}│{/} ${nav} {#666-fg}│{/} ${quit}`;
    } else if (loop.status === 'running') {
      actions = `${newLoop} ${refresh} ${viewLogs} ${metrics} {#ff4fd8-fg}[P]{/}ause {#ff4fd8-fg}[S]{/}top {#ff4fd8-fg}[I]{/}ntervene ${visibilityActions} {#666-fg}│{/} ${nav} {#666-fg}│{/} ${quit}`;
    } else if (loop.status === 'paused') {
      const isPrevSession = loop.pausedFromPreviousSession;
      const discardAction = isPrevSession ? ' {#ff4fd8-fg}[D]{/}iscard' : '';
      const resumeLabel = isPrevSession ? ' Resume(rebuild)' : ' Resume';
      actions = `${newLoop} ${refresh} ${viewLogs} ${metrics} {#ff4fd8-fg}[P]{/}${resumeLabel} {#ff4fd8-fg}[S]{/}top${discardAction} ${visibilityActions} {#666-fg}│{/} ${nav} {#666-fg}│{/} ${quit}`;
    } else if (loop.status === 'queued') {
      actions = `${newLoop} ${refresh} ${viewLogs} ${metrics} {#2de2e6-fg}Enter{/} Start {#ff4fd8-fg}[S]{/} Delete ${visibilityActions} {#666-fg}│{/} ${nav} {#666-fg}│{/} ${quit}`;
    } else if (loop.status === 'error') {
      actions = `${newLoop} ${refresh} ${viewLogs} ${metrics} {#ffbe0b-fg}[R] RETRY{/} {#ffbe0b-fg}[C] Mark Complete{/} ${visibilityActions} {#666-fg}│{/} ${nav} {#666-fg}│{/} ${quit}`;
    } else if (loop.status === 'stopped') {
      actions = `${newLoop} ${refresh} ${viewLogs} ${metrics} {#ffbe0b-fg}[R] RETRY{/} {#ffbe0b-fg}[C] Mark Complete{/} ${visibilityActions} {#666-fg}│{/} ${nav} {#666-fg}│{/} ${quit}`;
    } else if (loop.status === 'completed') {
      const closeIssueAction = loop.issueClosed ? '' : ` {#ff4fd8-fg}[C]{/}lose Issue`;
      const reviewAction = loop.reviewLoopId
        ? ' {#ff4fd8-fg}[V]{/} View Review'
        : loop.isReviewLoop
          ? ' {#ff4fd8-fg}[V]{/} View Original'
          : ' {#ff4fd8-fg}[V]{/} Request Review';
      actions = `${newLoop} ${refresh} ${viewLogs} ${metrics}${reviewAction}${closeIssueAction} ${visibilityActions} {#666-fg}│{/} ${nav} {#666-fg}│{/} ${quit}`;
    } else {
      actions = `${newLoop} ${refresh} ${viewLogs} ${metrics} ${visibilityActions} {#666-fg}│{/} ${nav} {#666-fg}│{/} ${quit}`;
    }

    statusBar.setContent(` ${actions}`);
  }

  // Initialize status bar
  updateStatusBar();

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP SELECTION HANDLER
  // ═══════════════════════════════════════════════════════════════════════════
  const handleLoopHighlight = (index: number): void => {
    const loop = loopListData[index];
    if (loop && loop.id !== selectedLoopId) {
      selectedLoopId = loop.id;
      updateDetailPane(loop);
      updateStatusBar(loop);
      loadLogsForLoop(loop.id);
      screen.render();
    }
  };

  // Update detail pane when navigating with arrow keys
  loopListWindow.on('select item', (_item: any, index: number) => {
    handleLoopHighlight(index);
  });

  // Also handle Enter key selection (same behavior now)
  loopListWindow.on('select', (_item: any, index: number) => {
    handleLoopHighlight(index);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW LOOP MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  screen.key(['n', 'N'], () => {
    if (isAnyInputActive()) return;

    // Get available adapters dynamically
    const availableAdapters = getAvailableAdapters();
    if (availableAdapters.length === 0) {
      logWithGlow('{#ff006e-fg}[error]{/} No agent adapters available', 'error');
      return;
    }

    let selectedAgentIndex = 0;
    let selectedAgent: string = availableAdapters[0].type;
    let skipPermissions = true;

    const modal = blessed.form({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ NEW LOOP{/} ',
      tags: true,
      top: 'center',
      left: 'center',
      width: 70,
      height: 22,
      border: 'line',
      style: { fg: 'white', bg: 'blue', transparent: true, border: { fg: 'magenta' } },
      shadow: true,
      keys: true,
      vi: false,
    } as any);

    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      tags: true,
      content: '{#eaeaea-fg}Paste a GitHub Issue URL:{/}',
    });

    const input = createCursorInput({
      parent: modal,
      top: 3,
      left: 2,
      width: 64,
      height: 3,
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' }, focus: { border: { fg: 'magenta' } } },
    }, screen);

    blessed.text({
      parent: modal,
      top: 6,
      left: 2,
      tags: true,
      content: '{#eaeaea-fg}Paste local repo root:{/}',
    });

    const repoInput = createCursorInput({
      parent: modal,
      top: 8,
      left: 2,
      width: 64,
      height: 3,
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' }, focus: { border: { fg: 'magenta' } } },
      value: process.cwd(),
    }, screen);

    blessed.text({
      parent: modal,
      top: 11,
      left: 2,
      tags: true,
      content: '{#eaeaea-fg}Max iterations (optional):{/}',
    });

    const maxIterInput = createCursorInput({
      parent: modal,
      top: 12,
      left: 2,
      width: 16,
      height: 3,
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' }, focus: { border: { fg: 'magenta' } } },
      value: String(MAX_ITERATIONS_DEFAULT),
    }, screen);

    // Use InputManager to safely handle switching between inputs
    const inputManager = createInputManager<ManagedInput>({
      onActivate: () => screen.render(),
    });

    // Click to focus/edit textboxes
    input.on('click', () => inputManager.activate(input));
    repoInput.on('click', () => inputManager.activate(repoInput));
    maxIterInput.on('click', () => inputManager.activate(maxIterInput));

    // Auto-focus first input when modal opens
    setTimeout(() => inputManager.activate(input), 50);

    // Tab to switch between inputs
    input.key(['tab'], () => inputManager.activate(repoInput));
    repoInput.key(['tab'], () => inputManager.activate(maxIterInput));
    maxIterInput.key(['tab'], () => inputManager.activate(input));

    blessed.text({
      parent: modal,
      top: 15,
      left: 2,
      tags: true,
      content: '{#9b5de5-fg}Agent:{/}',
    });

    // Create dynamic agent buttons
    const agentButtons: blessed.Widgets.ButtonElement[] = [];
    let leftOffset = 10;
    for (let i = 0; i < availableAdapters.length; i++) {
      const adapter = availableAdapters[i];
      const displayName = adapter.displayName || adapter.type;
      const btn = blessed.button({
        parent: modal,
        top: 15,
        left: leftOffset,
        width: displayName.length + 5,
        height: 1,
        tags: true,
        content: i === 0 ? `{#2de2e6-fg}[●]{/} ${displayName}` : `{#666-fg}[ ]{/} ${displayName}`,
        mouse: true,
        style: { fg: 'white', bg: 'transparent', hover: { fg: 'cyan' } },
      } as any);
      agentButtons.push(btn);
      leftOffset += displayName.length + 6;

      // Capture index in closure
      const idx = i;
      btn.on('press', () => {
        selectedAgentIndex = idx;
        selectedAgent = availableAdapters[idx].type;
        updateAgentButtons();
      });
    }

    blessed.text({
      parent: modal,
      top: 17,
      left: 2,
      tags: true,
      content: '{#9b5de5-fg}Options:{/}',
    });

    const skipPermBtn = blessed.button({
      parent: modal,
      top: 17,
      left: 11,
      width: 22,
      height: 1,
      tags: true,
      content: '{#00f5d4-fg}[✓]{/} Skip permissions',
      mouse: true,
      style: { fg: 'white', bg: 'transparent', hover: { fg: 'cyan' } },
    } as any);

    function updateAgentButtons(): void {
      for (let i = 0; i < agentButtons.length; i++) {
        const adapter = availableAdapters[i];
        const displayName = adapter.displayName || adapter.type;
        const isSelected = i === selectedAgentIndex;
        agentButtons[i].setContent(
          isSelected ? `{#2de2e6-fg}[●]{/} ${displayName}` : `{#666-fg}[ ]{/} ${displayName}`
        );
      }
      screen.render();
    }

    function updateSkipPermBtn(): void {
      skipPermBtn.setContent(skipPermissions ? '{#00f5d4-fg}[✓]{/} Skip permissions' : '{#666-fg}[ ]{/} Skip permissions');
      screen.render();
    }

    skipPermBtn.on('press', () => {
      skipPermissions = !skipPermissions;
      updateSkipPermBtn();
    });

    const createBtn = blessed.button({
      parent: modal,
      top: 19,
      left: 2,
      width: 16,
      height: 3,
      content: '  ◆ Create  ',
      align: 'center',
      style: { fg: 'black', bg: 'magenta', bold: true, hover: { bg: 'cyan' } },
      mouse: true,
      shadow: true,
    } as any);

    const cancelBtn = blessed.button({
      parent: modal,
      top: 19,
      left: 20,
      width: 14,
      height: 3,
      content: '  Cancel  ',
      align: 'center',
      style: { fg: 'white', bg: 240, hover: { bg: 'red' } },
      mouse: true,
    } as any);

    const closeModal = (): void => {
      inputManager.deactivate();  // Clean up input state before destroying
      modal.destroy();
      loopListWindow.focus();
      screen.render();
    };

    const handleCreate = async (): Promise<void> => {
      const url = input.getValue().trim();
      if (!url) {
        logWithGlow('{#ff006e-fg}[error]{/} Please enter a GitHub issue URL', 'error');
        screen.render();
        return;
      }

      const repoRootRaw = repoInput.getValue().trim();
      if (!repoRootRaw) {
        logWithGlow('{#ff006e-fg}[error]{/} Please enter the local repo root', 'error');
        screen.render();
        return;
      }
      const repoRoot = path.resolve(repoRootRaw);
      if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
        logWithGlow('{#ff006e-fg}[error]{/} Local repo root is not a directory', 'error');
        screen.render();
        return;
      }

      const maxIterRaw = maxIterInput.getValue().trim();
      let maxIterations = MAX_ITERATIONS_DEFAULT;
      if (maxIterRaw.length > 0) {
        const parsed = Number.parseInt(maxIterRaw, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          logWithGlow('{#ff006e-fg}[error]{/} Max iterations must be a positive number', 'error');
          screen.render();
          return;
        }
        maxIterations = parsed;
      }

      closeModal();
      logWithGlow(`{#666-fg}[system]{/} Fetching issue from ${url}...`, 'system');
      screen.render();

      const openCriteriaModal = (issue: Issue): void => {
        const originalCriteria = issue.originalAcceptanceCriteria?.map(criterion => ({ ...criterion }))
          ?? issue.acceptanceCriteria.map(criterion => ({ ...criterion }));
        const criteriaDraft = issue.acceptanceCriteria.length > 0
          ? issue.acceptanceCriteria.map(criterion => ({ ...criterion }))
          : [{ text: '', completed: false }];

        const modal = blessed.box({
          parent: screen,
          label: ' {bold}{#ff4fd8-fg}◆ ACCEPTANCE CRITERIA{/} ',
          tags: true,
          top: 'center',
          left: 'center',
          width: 100,
          height: 20,
          border: 'line',
          style: { fg: 'white', bg: 'blue', transparent: true, border: { fg: 'magenta' } },
          shadow: true,
          keys: true,
        } as any);

        blessed.text({
          parent: modal,
          top: 1,
          left: 2,
          tags: true,
          content: '{#eaeaea-fg}↑↓ navigate  Tab = edit  Enter = accept  [+] add  [-] remove{/}',
        });

        // Scrollable list container
        const listBox = blessed.list({
          parent: modal,
          top: 3,
          left: 2,
          width: 94,
          height: 12,
          border: 'line',
          scrollable: true,
          alwaysScroll: true,
          scrollbar: { ch: '│', track: { bg: 'black' }, style: { bg: 'cyan' } },
          keys: true,
          vi: true,
          mouse: true,
          tags: true,
          style: {
            border: { fg: 'cyan' },
            selected: { fg: 'black', bg: 'cyan' },
            item: { fg: 'white' },
          },
        } as any);

        let selectedIndex = 0;
        let editModal: blessed.Widgets.BoxElement | null = null;
        let scrollOffset = 0;
        let scrollInterval: ReturnType<typeof setInterval> | null = null;
        const maxVisibleChars = 82; // Account for line number prefix

        const renderList = (): void => {
          const items = criteriaDraft.map((c, i) => {
            const num = `{#666-fg}${String(i + 1).padStart(2)}.{/}`;
            const rawText = c.text || '';
            if (!rawText) return ` ${num} {#666-fg}(empty){/}`;

            const textLen = rawText.length;
            if (textLen <= maxVisibleChars) {
              return ` ${num} ${rawText}`;
            }

            // Scrolling text for long items
            const paddedText = rawText + '     ' + rawText; // Loop with gap
            const offset = scrollOffset % (textLen + 5);
            const visibleText = paddedText.slice(offset, offset + maxVisibleChars);
            return ` ${num} ${visibleText}`;
          });
          listBox.setItems(items);
          listBox.select(selectedIndex);
          screen.render();
        };

        // Start scroll animation for long AC text
        scrollInterval = setInterval(() => {
          scrollOffset++;
          renderList();
        }, 200);

        const startEditing = (index: number): void => {
          if (editModal) return;
          selectedIndex = index;

          // Create edit modal
          editModal = blessed.box({
            parent: screen,
            label: ` {bold}{#ffbe0b-fg}Edit Criterion ${index + 1}{/} `,
            tags: true,
            top: 'center',
            left: 'center',
            width: 90,
            height: 10,
            border: 'line',
            style: { fg: 'white', bg: 'black', border: { fg: 'yellow' } },
            shadow: true,
          } as any);

          const editInput = createCursorInput({
            parent: editModal,
            top: 1,
            left: 1,
            width: 86,
            height: 5,
            style: {
              fg: 'white',
              bg: '#111',
              border: { fg: 'cyan' },
            },
            value: criteriaDraft[index].text,
          }, screen);

          blessed.text({
            parent: editModal,
            top: 7,
            left: 2,
            tags: true,
            content: '{#2de2e6-fg}Enter{/} Save  {#ff4fd8-fg}Esc{/} Cancel',
          });

          const closeEditModal = (save: boolean) => {
            if (!editModal) return;
            if (save) {
              criteriaDraft[index].text = editInput.getValue().trim();
            }
            editInput.cancel();
            editModal.destroy();
            editModal = null;
            listBox.focus();
            renderList();
          };

          editInput.readInput(() => {
            // Enter pressed - save
            closeEditModal(true);
          });

          editInput.key(['escape'], () => {
            closeEditModal(false);
          });

          screen.render();
        };

        const stopEditing = (): void => {
          // No-op now, edit happens in modal
        };

        renderList();

        // List navigation
        listBox.on('select', (_item: any, index: number) => {
          selectedIndex = index;
        });

        // Tab to edit selected item
        listBox.key(['tab', 'e'], () => {
          startEditing(selectedIndex);
        });

        // Add new criterion
        listBox.key(['+', '=', 'a'], () => {
          stopEditing();
          criteriaDraft.push({ text: '', completed: false });
          selectedIndex = criteriaDraft.length - 1;
          renderList();
          setTimeout(() => startEditing(selectedIndex), 10);
        });

        // Remove selected criterion
        listBox.key(['-', 'x', 'delete'], () => {
          stopEditing();
          if (criteriaDraft.length > 1) {
            criteriaDraft.splice(selectedIndex, 1);
            selectedIndex = Math.min(selectedIndex, criteriaDraft.length - 1);
          } else {
            criteriaDraft[0].text = '';
          }
          renderList();
        });

        const closeCriteriaModal = (): void => {
          stopEditing();
          if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
          }
          modal.destroy();
          loopListWindow.focus();
          screen.render();
        };

        const finalizeCriteria = async (): Promise<void> => {
          stopEditing();

          const nextCriteria = criteriaDraft
            .filter(criterion => criterion.text.trim().length > 0)
            .map(criterion => ({ ...criterion, text: criterion.text.trim() }));

          const updatedBody = applyAcceptanceCriteriaToIssueBody(issue.body || '', nextCriteria);
          const updatedIssue: Issue = {
            ...issue,
            acceptanceCriteria: nextCriteria,
            originalAcceptanceCriteria: originalCriteria,
            body: updatedBody,
          };

          try {
            updateIssueBody(updatedIssue.url, updatedBody);
          } catch (err: any) {
            logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
          }

          const loop = await createLoop(updatedIssue, selectedAgent, skipPermissions, repoRoot, maxIterations);

          state = loadState();
          updateLoopList();
          updateHeader();
          updateTabBar();
          syncSelectionAfterFilter();

          const filteredIndex = loopListData.findIndex(l => l.id === loop.id);
          if (filteredIndex >= 0) {
            loopListWindow.select(filteredIndex);
            loopListWindow.emit('select', null, filteredIndex);
          }

          logWithGlow(`{#00f5d4-fg}[system]{/} Loop created: ${updatedIssue.title}`, 'system');
          logWithGlow(`{#666-fg}[system]{/} Press Enter to start the loop`, 'system');
          closeCriteriaModal();
        };

        // Bottom bar with hints
        blessed.text({
          parent: modal,
          top: 16,
          left: 2,
          tags: true,
          content: '{#2de2e6-fg}Enter{/} Accept  {#ff4fd8-fg}Esc{/} Cancel  {#ffbe0b-fg}+{/} Add  {#ffbe0b-fg}-{/} Remove  {#9b5de5-fg}Tab{/} Edit',
        });

        listBox.key(['enter'], () => {
          if (!editModal) {
            finalizeCriteria();
          }
        });

        modal.key(['escape', 'S-tab'], () => {
          if (!editModal) {
            closeCriteriaModal();
          }
        });

        listBox.key(['escape'], () => {
          if (!editModal) {
            closeCriteriaModal();
          }
        });

        listBox.focus();
      };

      try {
        const issue = await fetchIssue(url);
        openCriteriaModal(issue);
      } catch (err: any) {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        screen.render();
      }
    };

    createBtn.on('press', handleCreate);
    cancelBtn.on('press', closeModal);
    input.key(['escape'], closeModal);
    repoInput.key(['escape'], closeModal);
    maxIterInput.key(['escape'], closeModal);
    modal.key(['escape', 'S-tab'], closeModal);

    // Shift-tab within inputs to go backwards between fields
    input.key(['S-tab'], () => inputManager.activate(maxIterInput));
    repoInput.key(['S-tab'], () => inputManager.activate(input));
    maxIterInput.key(['S-tab'], () => inputManager.activate(repoInput));

    // Toggle permissions with Space (when not in input)
    modal.key(['space'], () => {
      if (screen.focused === input.box || screen.focused === repoInput.box || screen.focused === maxIterInput.box) {
        return;
      }
      skipPermissions = !skipPermissions;
      updateSkipPermBtn();
    });

    // Enter to submit (when not focused on input)
    modal.key(['enter'], () => {
      if (screen.focused === input.box || screen.focused === repoInput.box || screen.focused === maxIterInput.box) {
        return;
      }
      handleCreate();
    });

    screen.render();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION KEYS
  // ═══════════════════════════════════════════════════════════════════════════

  const confirmHideLoop = (loop: Loop, onConfirm: () => void): void => {
    const isRunning = loop.status === 'running';
    const confirm = blessed.box({
      parent: screen,
      label: isRunning
        ? ' {bold}{#ff006e-fg}⚠ WARNING{/} '
        : ' {bold}{#ff4fd8-fg}◆ CONFIRM HIDE{/} ',
      tags: true,
      top: 'center',
      left: 'center',
      width: 54,
      height: isRunning ? 11 : 7,
      border: 'line',
      style: {
        fg: 'white',
        bg: isRunning ? 'red' : 'blue',
        transparent: true,
        border: { fg: isRunning ? '#ff006e' : 'magenta' },
      },
      shadow: true,
    } as any);

    if (isRunning) {
      blessed.text({
        parent: confirm,
        top: 1,
        left: 'center',
        tags: true,
        content: '{bold}{#ffffff-fg}⚠  LOOP IS RUNNING  ⚠{/}',
      });
      blessed.text({
        parent: confirm,
        top: 3,
        left: 2,
        tags: true,
        content: `{#ffffff-fg}Hiding loop #${loop.issue.number} will NOT stop it.{/}`,
      });
      blessed.text({
        parent: confirm,
        top: 4,
        left: 2,
        tags: true,
        content: '{#ffffff-fg}It will continue running in the background!{/}',
      });
    } else {
      blessed.text({
        parent: confirm,
        top: 1,
        left: 2,
        tags: true,
        content: `{#eaeaea-fg}Hide ${loop.status} loop #${loop.issue.number}?{/}`,
      });
    }

    const btnTop = isRunning ? 7 : 3;
    const yesBtn = blessed.button({
      parent: confirm,
      top: btnTop,
      left: 2,
      width: 16,
      height: 1,
      content: isRunning ? 'Hide Anyway' : 'Yes',
      align: 'center',
      style: { fg: 'black', bg: isRunning ? '#ff006e' : 'magenta', bold: true, hover: { bg: 'cyan' } },
      mouse: true,
    } as any);

    const noBtn = blessed.button({
      parent: confirm,
      top: btnTop,
      left: 20,
      width: 10,
      height: 1,
      content: 'Cancel',
      align: 'center',
      style: { fg: 'white', bg: 240, hover: { bg: 'green' } },
      mouse: true,
    } as any);

    const closeConfirm = (): void => {
      confirm.destroy();
      loopListWindow.focus();
      screen.render();
    };

    const handleConfirm = (): void => {
      closeConfirm();
      onConfirm();
    };

    yesBtn.on('press', handleConfirm);
    noBtn.on('press', closeConfirm);
    confirm.key(['y', 'Y', 'enter'], handleConfirm);
    confirm.key(['n', 'N', 'escape'], closeConfirm);

    confirm.focus();
    screen.render();
  };

  const openBulkHideModal = (): void => {
    const modal = blessed.box({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ BULK HIDE{/} ',
      tags: true,
      top: 'center',
      left: 'center',
      width: 60,
      height: 11,
      border: 'line',
      style: { fg: 'white', bg: 'blue', transparent: true, border: { fg: 'magenta' } },
      shadow: true,
    } as any);

    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      tags: true,
      content: '{#eaeaea-fg}Hide completed loops older than N days:{/}',
    });

    const daysInput = createCursorInput({
      parent: modal,
      top: 3,
      left: 2,
      width: 10,
      height: 3,
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' }, focus: { border: { fg: 'magenta' } } },
      value: '30',
    }, screen);

    const inputManager = createInputManager<ManagedInput>({
      onActivate: () => screen.render(),
    });

    daysInput.on('click', () => inputManager.activate(daysInput));
    setTimeout(() => inputManager.activate(daysInput), 50);

    const closeModal = (): void => {
      modal.destroy();
      loopListWindow.focus();
      screen.render();
    };

    const applyBulkHide = (): void => {
      const raw = daysInput.getValue().trim();
      const days = Number.parseInt(raw, 10);
      if (!Number.isFinite(days) || days <= 0) {
        logWithGlow('{#ff006e-fg}[error]{/} Enter a valid number of days', 'error');
        closeModal();
        return;
      }
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      let nextState = loadState();
      let hiddenCount = 0;
      nextState = {
        ...nextState,
        loops: nextState.loops.map(loop => {
          if (loop.hidden) return loop;
          if (loop.status !== 'completed') return loop;
          const ts = loop.endedAt || loop.startedAt;
          const loopTime = ts ? new Date(ts).getTime() : 0;
          if (loopTime === 0 || loopTime > cutoff) return loop;
          hiddenCount += 1;
          return { ...loop, hidden: true };
        }),
      };
      saveState(nextState);
      state = nextState;
      if (hiddenCount === 0) {
        logWithGlow('{#ffbe0b-fg}[system]{/} No completed loops matched the cutoff', 'system');
      } else {
        logWithGlow(`{#00f5d4-fg}[system]{/} Hidden ${hiddenCount} completed loop(s)`, 'system');
      }
      closeModal();
      refreshAfterVisibilityChange();
    };

    const hideBtn = blessed.button({
      parent: modal,
      top: 7,
      left: 2,
      width: 12,
      height: 1,
      content: 'Hide',
      align: 'center',
      style: { fg: 'black', bg: 'magenta', bold: true, hover: { bg: 'cyan' } },
      mouse: true,
    } as any);

    const cancelBtn = blessed.button({
      parent: modal,
      top: 7,
      left: 16,
      width: 12,
      height: 1,
      content: 'Cancel',
      align: 'center',
      style: { fg: 'white', bg: 240, hover: { bg: 'red' } },
      mouse: true,
    } as any);

    hideBtn.on('press', applyBulkHide);
    cancelBtn.on('press', closeModal);
    daysInput.key(['enter'], applyBulkHide);
    daysInput.key(['escape'], closeModal);
    modal.key(['escape', 'S-tab'], closeModal);
    modal.key(['enter'], applyBulkHide);
    modal.key(['tab'], () => inputManager.activate(daysInput));

    screen.render();
  };

  // h - Hide selected loop
  screen.key(['h'], () => {
    if (isAnyInputActive()) return;
    if (showHidden) return; // Don't hide when viewing hidden list
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;
    if (loop.hidden) {
      logWithGlow('{#ffbe0b-fg}[system]{/} Loop already hidden', 'system');
      screen.render();
      return;
    }

    const hideLoop = (): void => {
      const updatedLoop = applyLoopUpdate(loop.id, { hidden: true });
      if (updatedLoop) {
        appendLog(loop.id, { type: 'system', content: 'Loop hidden by operator' });
      }
      logWithGlow(`{#00f5d4-fg}[system]{/} Hidden loop #${loop.issue.number}`, 'system');
      refreshAfterVisibilityChange();
    };

    if (loop.status === 'running' || loop.status === 'paused') {
      confirmHideLoop(loop, hideLoop);
      return;
    }

    hideLoop();
  });

  // Shift+H - Toggle hidden list view
  screen.key(['H', 'S-h'], () => {
    if (isAnyInputActive()) return;
    showHidden = !showHidden;
    refreshAfterVisibilityChange();
  });

  // U - Unhide selected loop (when viewing hidden list)
  screen.key(['u', 'U'], () => {
    if (isAnyInputActive()) return;
    if (!showHidden) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop || !loop.hidden) return;
    const updatedLoop = applyLoopUpdate(loop.id, { hidden: false });
    if (updatedLoop) {
      appendLog(loop.id, { type: 'system', content: 'Loop unhidden by operator' });
    }
    logWithGlow(`{#00f5d4-fg}[system]{/} Unhid loop #${loop.issue.number}`, 'system');
    refreshAfterVisibilityChange();
  });

  // B - Bulk hide completed loops older than N days
  screen.key(['b', 'B'], () => {
    if (isAnyInputActive()) return;
    openBulkHideModal();
  });

  // Enter - Start queued loop
  screen.key(['enter'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (loop?.status === 'queued') {
      // startLoop is async - fire and forget, errors handled via events
      startLoop(loop.id).catch((err: Error) => {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        screen.render();
      });
      // Immediate UI update
      state = loadState();
      const updatedLoop = state.loops.find(l => l.id === selectedLoopId);
      updateLoopList();
      updateHeader();
      updateTabBar();
      const selectionChanged = syncSelectionAfterFilter();
      if (!selectionChanged && updatedLoop) {
        updateDetailPane(updatedLoop);
        updateStatusBar(updatedLoop);
      }
      // Start tailing logs for the running loop
      loadLogsForLoop(loop.id);
      screen.render();
    }
  });

  // P - Pause/Resume
  screen.key(['p', 'P'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    try {
      if (loop.status === 'running') {
        pauseLoop(loop.id);
        state = loadState();
        const updatedLoop = state.loops.find(l => l.id === selectedLoopId);
        updateLoopList();
        updateHeader();
        updateTabBar();
        const selectionChanged = syncSelectionAfterFilter();
        if (!selectionChanged && updatedLoop) {
          updateDetailPane(updatedLoop);
          updateStatusBar(updatedLoop);
        }
        screen.render();
      } else if (loop.status === 'paused') {
        // Check if this is a cross-session resume (no active process)
        if (canResumeInSession(loop.id)) {
          // Same-session resume with SIGCONT
          resumeLoop(loop.id);
          state = loadState();
          const updatedLoop = state.loops.find(l => l.id === selectedLoopId);
          updateLoopList();
          updateHeader();
          updateTabBar();
          const selectionChanged = syncSelectionAfterFilter();
          if (!selectionChanged && updatedLoop) {
            updateDetailPane(updatedLoop);
            updateStatusBar(updatedLoop);
          }
          screen.render();
        } else {
          // Cross-session resume - spawn new process with context
          logWithGlow('{#ffbe0b-fg}[system]{/} Resuming loop from previous session...', 'system');
          screen.render();
          resumePausedLoop(loop.id).catch((err: Error) => {
            logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
            screen.render();
          });
        }
      }
    } catch (err: any) {
      logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
      screen.render();
    }
  });

  // S - Stop
  screen.key(['s', 'S'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    if (loop.status === 'running' || loop.status === 'paused') {
      try {
        stopLoop(loop.id);
        state = loadState();
        const updatedLoop = state.loops.find(l => l.id === selectedLoopId);
        updateLoopList();
        updateHeader();
        updateTabBar();
        const selectionChanged = syncSelectionAfterFilter();
        if (!selectionChanged && updatedLoop) {
          updateDetailPane(updatedLoop);
          updateStatusBar(updatedLoop);
        }
        screen.render();
      } catch (err: any) {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        screen.render();
      }
    }
  });

  // D - Discard paused loop from previous session
  screen.key(['d', 'D'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    if (loop.status === 'paused' && loop.pausedFromPreviousSession) {
      try {
        discardPausedLoop(loop.id);
        state = loadState();
        // Select next loop or clear selection
        const remainingLoops = state.loops;
        if (remainingLoops.length > 0) {
          selectedLoopId = remainingLoops[0].id;
        } else {
          selectedLoopId = null;
        }
        updateLoopList();
        updateHeader();
        updateTabBar();
        syncSelectionAfterFilter();
        if (selectedLoopId) {
          const newLoop = state.loops.find(l => l.id === selectedLoopId);
          if (newLoop) {
            updateDetailPane(newLoop);
            updateStatusBar(newLoop);
          }
        } else {
          detailWindow.setContent('{#666-fg}No loops.{/}');
          updateStatusBar();
        }
        logWithGlow('{#ffbe0b-fg}[system]{/} Paused loop discarded', 'system');
        screen.render();
      } catch (err: any) {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        screen.render();
      }
    }
  });

  // R - Retry errored/stopped loop
  screen.key(['r', 'R'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    if (loop.status === 'error' || loop.status === 'stopped') {
      retryLoop(loop.id).catch((err: Error) => {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        screen.render();
      });
      // Immediate UI update
      state = loadState();
      const updatedLoop = state.loops.find(l => l.id === selectedLoopId);
      updateLoopList();
      updateHeader();
      updateTabBar();
      const selectionChanged = syncSelectionAfterFilter();
      if (!selectionChanged && updatedLoop) {
        updateDetailPane(updatedLoop);
        updateStatusBar(updatedLoop);
      }
      // Refresh log view to show new retry logs
      loadLogsForLoop(loop.id);
      screen.render();
    }
  });

  // V - Navigate to review/parent loop, or request review
  screen.key(['v'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    // Navigate to review loop if exists
    if (loop.reviewLoopId) {
      const reviewLoop = state.loops.find(l => l.id === loop.reviewLoopId);
      if (reviewLoop) {
        selectedLoopId = reviewLoop.id;
        updateLoopList();
        updateDetailPane(reviewLoop);
        updateStatusBar(reviewLoop);
        loadLogsForLoop(reviewLoop.id);
        screen.render();
        return;
      }
    }

    // Navigate to parent loop if this is a review
    if (loop.parentLoopId) {
      const parentLoop = state.loops.find(l => l.id === loop.parentLoopId);
      if (parentLoop) {
        selectedLoopId = parentLoop.id;
        updateLoopList();
        updateDetailPane(parentLoop);
        updateStatusBar(parentLoop);
        loadLogsForLoop(parentLoop.id);
        screen.render();
        return;
      }
    }

    // Otherwise request a review if loop is completed
    if (loop.status === 'completed' && !loop.reviewLoopId && !loop.isReviewLoop) {
      showReviewAgentSelector(loop);
    }
  });

  // Shift+V - Request review (show agent selector)
  screen.key(['S-v', 'V'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    if (loop.status !== 'completed') {
      logWithGlow('{#ffbe0b-fg}[system]{/} Can only review completed loops', 'system');
      screen.render();
      return;
    }
    if (loop.reviewLoopId) {
      logWithGlow('{#ffbe0b-fg}[system]{/} Loop already has a review', 'system');
      screen.render();
      return;
    }
    if (loop.isReviewLoop) {
      logWithGlow('{#ffbe0b-fg}[system]{/} Cannot review a review loop', 'system');
      screen.render();
      return;
    }

    showReviewAgentSelector(loop);
  });

  // Show agent selector modal for requesting review
  function showReviewAgentSelector(loop: Loop): void {
    const adapters = getAvailableAdapters().filter(a => a.type !== loop.agent);
    if (adapters.length === 0) {
      logWithGlow('{#ff006e-fg}[error]{/} No different agents available for review', 'error');
      screen.render();
      return;
    }

    const modal = blessed.box({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ REQUEST REVIEW{/} ',
      tags: true,
      top: 'center',
      left: 'center',
      width: 50,
      height: adapters.length + 6,
      border: 'line',
      style: { fg: 'white', bg: 'black', transparent: true, border: { fg: '#ff4fd8' } },
      shadow: true,
    } as any);

    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      tags: true,
      content: `{#9b5de5-fg}Select reviewer agent:{/}`,
    });

    const agentList = blessed.list({
      parent: modal,
      top: 3,
      left: 2,
      width: '90%',
      height: adapters.length,
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        fg: 'white',
        selected: { fg: 'black', bg: '#ff4fd8' },
      },
      items: adapters.map(a => a.displayName || a.type),
    } as any);

    agentList.focus();
    screen.render();

    agentList.on('select', async (_item: any, index: number) => {
      const selectedAgent = adapters[index];
      modal.destroy();
      screen.render();

      try {
        logWithGlow(`{#ff4fd8-fg}[review]{/} Creating review with ${selectedAgent.type}...`, 'system');
        screen.render();

        const reviewLoop = await createReviewLoop(loop.id, selectedAgent.type);

        // Start the review loop
        startLoop(reviewLoop.id).catch((err: Error) => {
          logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
          screen.render();
        });

        // Update UI
        state = loadState();
        updateLoopList();
        updateHeader();
        updateTabBar();

        // Select the new review loop
        selectedLoopId = reviewLoop.id;
        const updatedReviewLoop = state.loops.find(l => l.id === reviewLoop.id);
        if (updatedReviewLoop) {
          updateDetailPane(updatedReviewLoop);
          updateStatusBar(updatedReviewLoop);
          loadLogsForLoop(reviewLoop.id);
        }

        logWithGlow(`{#ff4fd8-fg}[review]{/} Review loop started`, 'system');
        screen.render();
      } catch (err: any) {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        screen.render();
      }
    });

    agentList.key(['escape', 'q'], () => {
      modal.destroy();
      screen.render();
    });
  }

  // Function to handle closing a GitHub issue (extracted for reuse)
  function handleCloseIssue(loop: Loop): void {
    if (loop.issueClosed) {
      logWithGlow('{#ffbe0b-fg}[system]{/} Issue already closed', 'system');
      screen.render();
      return;
    }

    const modal = blessed.box({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ CLOSE ISSUE{/} ',
      tags: true,
      top: 'center',
      left: 'center',
      width: 70,
      height: 12,
      border: 'line',
      style: { fg: 'white', bg: 'blue', transparent: true, border: { fg: 'magenta' } },
      shadow: true,
    } as any);

    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      tags: true,
      content: `{#eaeaea-fg}Optional comment for issue #${loop.issue.number}:{/}`,
    });

    const commentInput = createCursorInput({
      parent: modal,
      top: 3,
      left: 2,
      width: 64,
      height: 3,
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' }, focus: { border: { fg: 'magenta' } } },
    }, screen);

    const inputManager = createInputManager<ManagedInput>({
      onActivate: () => screen.render(),
    });

    commentInput.on('click', () => inputManager.activate(commentInput));
    setTimeout(() => inputManager.activate(commentInput), 50);

    const closeModal = (): void => {
      modal.destroy();
      loopListWindow.focus();
      screen.render();
    };

    const showConfirm = (comment?: string): void => {
      const confirm = blessed.box({
        parent: screen,
        label: ' {bold}{#ff4fd8-fg}◆ CONFIRM{/} ',
        tags: true,
        top: 'center',
        left: 'center',
        width: 50,
        height: 7,
        border: 'line',
        style: { fg: 'white', bg: 'blue', transparent: true, border: { fg: 'magenta' } },
        shadow: true,
      } as any);

      blessed.text({
        parent: confirm,
        top: 1,
        left: 2,
        tags: true,
        content: `{#eaeaea-fg}Close issue #${loop.issue.number}?{/}`,
      });

      const yesBtn = blessed.button({
        parent: confirm,
        top: 3,
        left: 2,
        width: 10,
        height: 1,
        content: 'Yes',
        align: 'center',
        style: { fg: 'black', bg: 'magenta', bold: true, hover: { bg: 'cyan' } },
        mouse: true,
      } as any);

      const noBtn = blessed.button({
        parent: confirm,
        top: 3,
        left: 14,
        width: 10,
        height: 1,
        content: 'No',
        align: 'center',
        style: { fg: 'white', bg: 240, hover: { bg: 'red' } },
        mouse: true,
      } as any);

      const closeConfirm = (): void => {
        confirm.destroy();
        screen.render();
      };

      const doCloseIssue = (): void => {
        closeConfirm();
        closeModal();

        try {
          const result = closeIssue(loop.issue.url, comment);
          let nextState = loadState();
          nextState = updateLoop(nextState, loop.id, { issueClosed: true });
          saveState(nextState);
          state = nextState;

          const updatedLoop = state.loops.find(l => l.id === loop.id);
          updateLoopList();
          updateHeader();
          updateTabBar();
          const selectionChanged = syncSelectionAfterFilter();
          if (!selectionChanged && updatedLoop) {
            updateDetailPane(updatedLoop);
            updateStatusBar(updatedLoop);
          }

          if (result === 'already_closed') {
            logWithGlow(`{#ffbe0b-fg}[system]{/} Issue #${loop.issue.number} was already closed`, 'system');
          } else {
            logWithGlow(`{#00f5d4-fg}[system]{/} Closed issue #${loop.issue.number}`, 'system');
          }
        } catch (err: any) {
          logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        }
        screen.render();
      };

      yesBtn.on('press', doCloseIssue);
      noBtn.on('press', () => {
        closeConfirm();
        closeModal();
      });

      confirm.key(['y', 'Y', 'enter'], doCloseIssue);
      confirm.key(['n', 'N', 'escape'], () => {
        closeConfirm();
        closeModal();
      });

      confirm.focus();
      screen.render();
    };

    const closeBtn = blessed.button({
      parent: modal,
      top: 7,
      left: 2,
      width: 12,
      height: 1,
      content: 'Close',
      align: 'center',
      style: { fg: 'black', bg: 'magenta', bold: true, hover: { bg: 'cyan' } },
      mouse: true,
    } as any);

    const cancelBtn = blessed.button({
      parent: modal,
      top: 7,
      left: 16,
      width: 12,
      height: 1,
      content: 'Cancel',
      align: 'center',
      style: { fg: 'white', bg: 240, hover: { bg: 'red' } },
      mouse: true,
    } as any);

    const proceedToConfirm = (): void => {
      const comment = commentInput.getValue().trim();
      showConfirm(comment || undefined);
    };

    closeBtn.on('press', proceedToConfirm);
    cancelBtn.on('press', closeModal);
    commentInput.key(['enter'], proceedToConfirm);
    commentInput.key(['escape'], closeModal);
    modal.key(['escape', 'S-tab'], closeModal);
    modal.key(['y', 'Y', 'enter'], proceedToConfirm);

    screen.render();
  }

  // C - Mark errored/stopped loop as completed, OR close issue for completed loops
  screen.key(['c', 'C'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    // Route to appropriate action based on status
    if (loop.status === 'completed') {
      // Delegate to Close Issue logic (defined below as handleCloseIssue)
      handleCloseIssue(loop);
      return;
    }

    if (loop.status !== 'error' && loop.status !== 'stopped') {
      // No action for running/paused/queued loops
      return;
    }

    const modal = blessed.box({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ MARK COMPLETE{/} ',
      tags: true,
      top: 'center',
      left: 'center',
      width: 70,
      height: 12,
      border: 'line',
      style: { fg: 'white', bg: 'blue', transparent: true, border: { fg: 'magenta' } },
      shadow: true,
    } as any);

    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      tags: true,
      content: `{#eaeaea-fg}Mark loop #${loop.issue.number} as completed?{/}`,
    });

    blessed.text({
      parent: modal,
      top: 3,
      left: 2,
      tags: true,
      content: '{#eaeaea-fg}Optional completion note:{/}',
    });

    const noteInput = createCursorInput({
      parent: modal,
      top: 5,
      left: 2,
      width: 64,
      height: 3,
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' }, focus: { border: { fg: 'magenta' } } },
    }, screen);

    const inputManager = createInputManager<ManagedInput>({
      onActivate: () => screen.render(),
    });

    noteInput.on('click', () => inputManager.activate(noteInput));
    setTimeout(() => inputManager.activate(noteInput), 50);

    const closeModal = (): void => {
      modal.destroy();
      loopListWindow.focus();
      screen.render();
    };

    const handleConfirm = (): void => {
      const note = noteInput.getValue().trim();
      try {
        markLoopManualComplete(loop.id, note);
        state = loadState();
        const updatedLoop = state.loops.find(l => l.id === loop.id);
        updateLoopList();
        updateHeader();
        updateTabBar();
        const selectionChanged = syncSelectionAfterFilter();
        if (!selectionChanged && updatedLoop) {
          updateDetailPane(updatedLoop);
          updateStatusBar(updatedLoop);
        }
        loadLogsForLoop(loop.id);
        logWithGlow('{#00f5d4-fg}[system]{/} Loop marked complete', 'system');
      } catch (err: any) {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
      }
      closeModal();
    };

    const confirmBtn = blessed.button({
      parent: modal,
      top: 9,
      left: 2,
      width: 16,
      height: 1,
      content: 'Mark Complete',
      align: 'center',
      style: { fg: 'black', bg: 'magenta', bold: true, hover: { bg: 'cyan' } },
      mouse: true,
    } as any);

    const cancelBtn = blessed.button({
      parent: modal,
      top: 9,
      left: 20,
      width: 12,
      height: 1,
      content: 'Cancel',
      align: 'center',
      style: { fg: 'white', bg: 240, hover: { bg: 'red' } },
      mouse: true,
    } as any);

    confirmBtn.on('press', handleConfirm);
    cancelBtn.on('press', closeModal);
    noteInput.key(['enter'], handleConfirm);
    noteInput.key(['escape'], closeModal);
    modal.key(['y', 'Y', 'enter'], handleConfirm);
    modal.key(['n', 'N', 'escape', 'S-tab'], closeModal);

    screen.render();
  });

  // I - Intervene
  screen.key(['i', 'I'], () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (loop?.status !== 'running') {
      logWithGlow('{#ff006e-fg}[error]{/} Can only intervene in running loops', 'error');
      screen.render();
      return;
    }

    const modal = blessed.box({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ INTERVENE{/} ',
      tags: true,
      top: 'center',
      left: 'center',
      width: 60,
      height: 10,
      border: 'line',
      style: { fg: 'white', bg: 'blue', transparent: true, border: { fg: 'magenta' } },
      shadow: true,
    } as any);

    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      tags: true,
      content: '{#eaeaea-fg}Send a message to the agent:{/}',
    });

    const input = blessed.textbox({
      parent: modal,
      top: 3,
      left: 2,
      width: 54,
      height: 3,
      border: 'line',
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' } },
      inputOnFocus: true,
      mouse: true,
    } as any);

    const closeModal = (): void => {
      modal.destroy();
      loopListWindow.focus();
      screen.render();
    };

    input.key(['enter'], () => {
      const message = (input as any).getValue().trim();
      if (message && selectedLoopId) {
        try {
          sendIntervention(selectedLoopId, message);
        } catch (err: any) {
          logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        }
      }
      closeModal();
    });

    input.key(['escape', 'S-tab'], closeModal);
    input.focus();
    screen.render();
  });

  // L - View full log
  screen.key(['l', 'L'], () => {
    if (isAnyInputActive()) return;
    if (logViewer) {
      closeLogViewer();
      return;
    }
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;
    openLogViewer(loop);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // METRICS DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════
  let metricsDashboard: blessed.Widgets.BoxElement | null = null;
  let metricsIncludeHidden = true;

  function openMetricsDashboard(): void {
    if (metricsDashboard) {
      closeMetricsDashboard();
      return;
    }

    const metrics: DashboardMetrics = calculateMetrics(state.loops, metricsIncludeHidden, METRICS_TREND_DAYS, METRICS_TREND_WEEKS, METRICS_TOP_FAILURES);
    const w = (screen.width as number) || 120;
    const h = (screen.height as number) || 40;

    metricsDashboard = blessed.box({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ METRICS DASHBOARD{/} ',
      tags: true,
      top: 1,
      left: 2,
      width: w - 4,
      height: h - 4,
      border: 'line',
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: '█', style: { bg: 'magenta' } },
      style: {
        fg: 'white',
        bg: 'black',
        transparent: true,
        border: { fg: '#ff4fd8' },
        label: { fg: '#ff4fd8' },
      },
      padding: { left: 1, right: 1, top: 0, bottom: 0 },
    } as any);

    const contentWidth = w - 10;
    const barWidth = Math.floor(contentWidth * 0.4);

    // Build dashboard content
    let content = '';

    // ─── SUMMARY SECTION ───
    content += `{bold}{#ff4fd8-fg}◆ SUMMARY{/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    const { summary } = metrics;
    const totalNonZero = summary.total || 1;
    content += `  Total Loops:    {#2de2e6-fg}${summary.total}{/}\n`;
    content += `  Completed:      {#00f5d4-fg}${summary.completed}{/} (${Math.round((summary.completed / totalNonZero) * 100)}%)\n`;
    content += `  Failed:         {#ff006e-fg}${summary.failed}{/} (${Math.round((summary.failed / totalNonZero) * 100)}%)\n`;
    content += `  In Progress:    {#2de2e6-fg}${summary.inProgress}{/}\n`;
    content += `  Paused:         {#ffbe0b-fg}${summary.paused}{/}\n`;
    content += `  Queued:         {#666-fg}${summary.queued}{/}\n`;
    content += `  Stopped:        {#666-fg}${summary.stopped}{/}\n\n`;

    // ─── TIME TO COMPLETION ───
    content += `{bold}{#ff4fd8-fg}◆ TIME TO COMPLETION{/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    content += `  Average: {#2de2e6-fg}${formatDurationMs(metrics.avgTimeToCompletionMs)}{/}\n\n`;

    // ─── PER-AGENT SUCCESS RATES ───
    content += `{bold}{#ff4fd8-fg}◆ PER-AGENT SUCCESS RATES{/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    if (metrics.perAgent.length === 0) {
      content += `  {#666-fg}No agent data yet.{/}\n`;
    } else {
      for (const agent of metrics.perAgent) {
        const bar = renderHorizontalBar(agent.successRate, 100, barWidth);
        const avgDur = formatDurationMs(agent.avgDurationMs);
        content += `  {#9b5de5-fg}${agent.agent.padEnd(10)}{/} ${bar} {#2de2e6-fg}${Math.round(agent.successRate)}%{/}  ${agent.loopsRun} runs  avg ${avgDur}\n`;
      }
    }
    content += '\n';

    // ─── DAILY COMPLETIONS ───
    content += `{bold}{#ff4fd8-fg}◆ DAILY COMPLETIONS (${METRICS_TREND_DAYS} DAYS){/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    const dailyValues = metrics.dailyTrend.map(d => d.completed);
    const chartHeight = 6;
    const chartLines = renderVerticalBars(dailyValues, chartHeight, 2, 1);
    for (const line of chartLines) {
      content += `  {#2de2e6-fg}${line}{/}\n`;
    }
    // Labels - show day of month (DD from YYYY-MM-DD)
    const labelLine = metrics.dailyTrend.map(d => d.date.slice(8)).join(' ');
    content += `  {#666-fg}${labelLine}{/}\n\n`;

    // ─── ITERATION STATS ───
    content += `{bold}{#ff4fd8-fg}◆ ITERATION STATS{/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    const { iterationStats } = metrics;
    content += `  Average iterations: {#2de2e6-fg}${iterationStats.avgIterations.toFixed(1)}{/}\n`;
    content += `  Min: {#00f5d4-fg}${iterationStats.minIterations}{/}  Max: {#ff006e-fg}${iterationStats.maxIterations}{/}\n`;
    content += `  Total iterations:   {#666-fg}${iterationStats.totalIterations}{/}\n\n`;

    // ─── TOP FAILURE REASONS ───
    content += `{bold}{#ff4fd8-fg}◆ TOP FAILURE REASONS{/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    if (metrics.topFailureReasons.length === 0) {
      content += `  {#00f5d4-fg}No failures recorded!{/}\n`;
    } else {
      const maxFail = Math.max(...metrics.topFailureReasons.map(r => r.count), 1);
      for (const reason of metrics.topFailureReasons) {
        const bar = renderHorizontalBar(reason.count, maxFail, Math.floor(barWidth / 2));
        content += `  {#ff006e-fg}${reason.reason.padEnd(18)}{/} ${bar} {#666-fg}${reason.count}{/}\n`;
      }
    }
    content += '\n';

    // ─── CIRCUIT BREAKER STATS ───
    content += `{bold}{#ff4fd8-fg}◆ CIRCUIT BREAKER TRIGGERS{/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    const { circuitBreakerStats } = metrics;
    content += `  Total triggers: {#ffbe0b-fg}${circuitBreakerStats.totalTriggers}{/}\n`;
    content += `  └─ no_progress:     {#ff006e-fg}${circuitBreakerStats.byReason.noProgress}{/}\n`;
    content += `  └─ same_error:      {#ff006e-fg}${circuitBreakerStats.byReason.sameError}{/}\n`;
    content += `  └─ test_saturation: {#ffbe0b-fg}${circuitBreakerStats.byReason.testSaturation}{/}\n`;
    content += `  └─ other:           {#666-fg}${circuitBreakerStats.byReason.other}{/}\n\n`;

    // ─── HOURLY ACTIVITY HEATMAP ───
    content += `{bold}{#ff4fd8-fg}◆ HOURLY ACTIVITY HEATMAP{/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    const hourlyValues = metrics.hourlyActivity.map(h => h.count);
    const heatmap = renderHeatmap(hourlyValues);
    content += `  {#2de2e6-fg}${heatmap}{/}\n`;
    content += `  {#666-fg}12am      6am       12pm      6pm       12am{/}\n`;
    const peakHour = metrics.hourlyActivity.reduce((max, h) => h.count > max.count ? h : max, { hour: 0, count: 0 });
    content += `  Peak: {#ffbe0b-fg}${peakHour.hour}:00{/} (${peakHour.count} loops)\n\n`;

    // ─── CRITERIA COMPLETION ───
    content += `{bold}{#ff4fd8-fg}◆ CRITERIA COMPLETION{/}{/bold}\n`;
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    const { criteriaStats } = metrics;
    const agentPct = criteriaStats.totalCriteria > 0 ? Math.round((criteriaStats.agentCompleted / criteriaStats.totalCriteria) * 100) : 0;
    const operatorPct = criteriaStats.totalCriteria > 0 ? Math.round((criteriaStats.operatorCompleted / criteriaStats.totalCriteria) * 100) : 0;
    content += `  Total criteria:     {#666-fg}${criteriaStats.totalCriteria}{/}\n`;
    content += `  Agent completed:    {#00f5d4-fg}${criteriaStats.agentCompleted}{/} (${agentPct}%)\n`;
    content += `  Operator completed: {#ffbe0b-fg}${criteriaStats.operatorCompleted}{/} (${operatorPct}%)\n`;
    content += `  Completion rate:    {#2de2e6-fg}${Math.round(criteriaStats.completionRate)}%{/}\n\n`;

    // ─── FOOTER ───
    const hiddenStatus = metricsIncludeHidden ? 'included' : 'excluded';
    content += `{#666-fg}${'─'.repeat(Math.min(contentWidth, 60))}{/}\n`;
    content += `  {#ff4fd8-fg}[E]{/} Export JSON  {#ff4fd8-fg}[H]{/} Toggle hidden (${hiddenStatus})  {#ff4fd8-fg}[Esc]{/} Close\n`;

    metricsDashboard.setContent(content);
    metricsDashboard.focus();
    screen.render();
  }

  function closeMetricsDashboard(): void {
    if (metricsDashboard) {
      metricsDashboard.destroy();
      metricsDashboard = null;
      loopListWindow.focus();
      screen.render();
    }
  }

  function exportMetricsFunc(): void {
    const metrics: DashboardMetrics = calculateMetrics(state.loops, metricsIncludeHidden, METRICS_TREND_DAYS, METRICS_TREND_WEEKS, METRICS_TOP_FAILURES);
    const json = exportMetricsToJson(metrics);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(DATA_DIR, `metrics-export-${timestamp}.json`);
    fs.writeFileSync(filePath, json);
    logWithGlow(`{#00f5d4-fg}[system]{/} Metrics exported to ${filePath}`, 'system');
    screen.render();
  }

  // M - Open metrics dashboard
  screen.key(['m', 'M'], () => {
    if (isAnyInputActive()) return;
    openMetricsDashboard();
  });

  // Dashboard-specific keys when open
  screen.key(['escape'], () => {
    if (metricsDashboard) {
      closeMetricsDashboard();
    }
  });

  screen.key(['e', 'E'], () => {
    if (metricsDashboard) {
      exportMetricsFunc();
    }
  });

  screen.key(['h'], () => {
    if (metricsDashboard) {
      metricsIncludeHidden = !metricsIncludeHidden;
      closeMetricsDashboard();
      openMetricsDashboard();
    }
  });

  // T - Refresh issue data
  screen.key(['t', 'T'], async () => {
    if (isAnyInputActive()) return;
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    detailWindow.setContent(
      `{bold}{#fff-fg}${loop.issue.title}{/}{/bold}\n` +
      `{#666-fg}─────────────────────────────────────────────────────{/}\n` +
      `{#ffbe0b-fg}Refreshing issue data...{/}`
    );
    logWithGlow(`{#666-fg}[system]{/} Refreshing issue #${loop.issue.number}...`, 'system');
    screen.render();

    try {
      const issue = await fetchIssue(loop.issue.url);
      let nextState = loadState();
      nextState = updateLoop(nextState, loop.id, { issue });
      saveState(nextState);
      state = nextState;

      updateLoopList();
      updateHeader();
      updateTabBar();
      const selectionChanged = syncSelectionAfterFilter();
      const updatedLoop = state.loops.find(l => l.id === loop.id);
      if (!selectionChanged && updatedLoop) {
        updateDetailPane(updatedLoop);
        updateStatusBar(updatedLoop);
      }

      logWithGlow(`{#00f5d4-fg}[system]{/} Issue refreshed: ${issue.title}`, 'system');
    } catch (err: any) {
      logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
      const currentLoop = state.loops.find(l => l.id === selectedLoopId);
      if (currentLoop) {
        updateDetailPane(currentLoop);
      }
    }
    screen.render();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP EVENTS - Update UI on state changes
  // ═══════════════════════════════════════════════════════════════════════════
  loopEvents.on('event', () => {
    state = loadState();
    updateLoopList();
    updateHeader();
    updateTabBar();
    const selectionChanged = syncSelectionAfterFilter();
    if (!selectionChanged && selectedLoopId) {
      const loop = state.loops.find(l => l.id === selectedLoopId);
      if (loop) {
        updateDetailPane(loop);
        updateStatusBar(loop);
      }
    }
    screen.render();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP ON EXIT
  // ═══════════════════════════════════════════════════════════════════════════
  screen.on('destroy', () => {
    if (logTailCleanup) logTailCleanup();
    killAll();
  });

  // Initial render
  loopListWindow.focus();
  setActiveTab(activeTabIndex);
  if (state.loops.length > 0) {
    loopListWindow.select(0);
    loopListWindow.emit('select', null, 0);
  }
  screen.render();
}

// CLI routing
const { command, flags } = parseArgs();

if (command === 'configure') {
  runConfigure(flags);
  process.exit(0);
} else if (command === 'clean') {
  runClean(flags).then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (command === 'uninstall') {
  const dryRun = flags['--dry-run'] === true;
  runUninstallWizard(dryRun).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (command === 'help') {
  showHelp();
  process.exit(0);
} else {
  // Default: launch TUI (with optional tutorial)
  if (shouldShowTutorial(flags)) {
    const screen = createScreen();
    runTutorial(screen).then(() => {
      screen.destroy();
      main();
    });
  } else {
    main();
  }
}
