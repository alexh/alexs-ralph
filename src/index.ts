#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import blessed from 'blessed';
import { createScreen } from './ui/screen.js';
import { colors } from './config.js';
import { statusColors, statusIcons } from './ui/theme.js';
import {
  Loop,
  LoopStatus,
  loadState,
  saveState,
  fetchIssue,
  createLoop,
  startLoop,
  pauseLoop,
  resumeLoop,
  stopLoop,
  sendIntervention,
  loopEvents,
  readRecentLogs,
  tailLog,
  formatLogEntry,
  killAll,
} from './core/index.js';
import './adapters/index.js';  // Register adapters

function main(): void {
  const screen = createScreen();

  // App state
  let state = loadState();
  let selectedLoopId: string | null = state.loops[0]?.id || null;
  let logTailCleanup: (() => void) | null = null;

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
    strobeUntil: 0,
  };
  const glowChars = ' .:-=+*#%@';
  const glowColors = ['#130815', '#1c0b2a', '#2a0f4f', '#2e1a7a', '#0f3a7a', '#0a5fb8', '#00a5d8', '#00f5d4', '#ff4fd8'];
  const pulseColors = ['#ff4fd8', '#2de2e6', '#00f5d4', '#ffbe0b'];

  function triggerBackgroundGlow(kind: 'log' | 'error' | 'system' = 'log'): void {
    const now = Date.now();
    const w = (screen.width as number) || 80;
    const h = (screen.height as number) || 24;
    const color = kind === 'error' ? '#ff006e' : kind === 'system' ? '#ffbe0b' : pulseColors[Math.floor(Math.random() * pulseColors.length)];
    bgState.pulses.push({
      x: Math.random(),
      y: Math.random(),
      strength: kind === 'error' ? 1.4 : 1.0,
      born: now,
      life: kind === 'error' ? 2600 : 2000,
      color,
    });
    bgState.logFlash = Math.min(1, bgState.logFlash + 0.45);
    if (kind === 'error') {
      bgState.strobeUntil = now + 900;
      bgState.logFlash = Math.min(1.4, bgState.logFlash + 0.8);
    }
    if (w < 30 || h < 10) return;
  }

  function generateLightShow(): string {
    const now = Date.now();
    const t = (now - bgState.start) / 1000;
    const w = (screen.width as number) || 80;
    const h = (screen.height as number) || 24;
    const breath = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.45));
    bgState.logFlash *= 0.93;
    const strobeActive = now < bgState.strobeUntil;
    const strobePulse = strobeActive ? 0.65 + 0.35 * Math.sin(t * 22) : 0;

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

        intensity += bgState.logFlash * 0.5;
        if (strobeActive) intensity += strobePulse * 0.8;
        intensity = Math.max(0, Math.min(1.2, intensity));

        const charIdx = Math.min(glowChars.length - 1, Math.floor(intensity * (glowChars.length - 1)));
        const hueSeed = Math.sin(nx * 4 + ny * 3 + t * 0.4) * 0.5 + 0.5;
        const baseColorIdx = Math.min(glowColors.length - 1, Math.floor(hueSeed * (glowColors.length - 1)));
        const colorIdx = Math.min(glowColors.length - 1, Math.floor((baseColorIdx + intensity * 3)));
        const char = glowChars[charIdx];
        const color = strobeActive && intensity > 0.65 ? '#ffffff' : glowColors[colorIdx];
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

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER BAR
  // ═══════════════════════════════════════════════════════════════════════════
  const headerBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    style: { fg: 'white', bg: 'black', transparent: true },
  } as any);

  function updateHeader(): void {
    const counts = {
      running: state.loops.filter(l => l.status === 'running').length,
      paused: state.loops.filter(l => l.status === 'paused').length,
      completed: state.loops.filter(l => l.status === 'completed').length,
      error: state.loops.filter(l => l.status === 'error').length,
    };
    headerBox.setContent(
      `\n {bold}{#ff4fd8-fg}◆ ALEX{/}{/bold} {#666-fg}│{/} ` +
      `{#2de2e6-fg}${counts.running}{/} running {#666-fg}│{/} ` +
      `{#ffbe0b-fg}${counts.paused}{/} paused {#666-fg}│{/} ` +
      `{#00f5d4-fg}${counts.completed}{/} done {#666-fg}│{/} ` +
      `{#ff006e-fg}${counts.error}{/} errors`
    );
  }
  updateHeader();

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP LIST
  // ═══════════════════════════════════════════════════════════════════════════
  const loopListWindow = blessed.list({
    parent: screen,
    label: ' {bold}{#ff4fd8-fg}◆ LOOPS{/} ',
    tags: true,
    top: 4,
    left: 1,
    width: '30%-2',
    height: '100%-8',
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


  function formatDuration(startedAt?: string): string {
    if (!startedAt) return '--';
    const ms = Date.now() - new Date(startedAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}h${mins % 60}m`;
  }

  function updateLoopList(): void {
    if (state.loops.length === 0) {
      loopListWindow.setItems(['{#666-fg}No loops yet. Press [N] to create one.{/}']);
      return;
    }
    const items = state.loops.map((loop) => {
      const icon = statusIcons[loop.status] || '?';
      const color = statusColors[loop.status] || colors.text;
      const time = formatDuration(loop.startedAt);
      const prefix = loop.agent === 'claude' ? 'CLA' : 'CDX';
      const title = loop.issue.title.substring(0, 22);
      return ` {${color}-fg}${icon}{/} {bold}${prefix} #${loop.issue.number}{/} ${title}... {#666-fg}${time}{/}`;
    });
    loopListWindow.setItems(items);
  }
  updateLoopList();

  // ═══════════════════════════════════════════════════════════════════════════
  // DETAIL PANE
  // ═══════════════════════════════════════════════════════════════════════════
  const detailWindow = blessed.box({
    parent: screen,
    label: ' {bold}{#2de2e6-fg}◆ LOOP DETAIL{/} ',
    tags: true,
    top: 4,
    left: '30%',
    width: '70%-1',
    height: '50%-3',
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

  function updateDetailPane(loop: Loop): void {
    const statusColor = statusColors[loop.status] || colors.text;
    const statusIcon = statusIcons[loop.status] || '?';
    const time = formatDuration(loop.startedAt);

    let content =
      `{bold}{#fff-fg}${loop.issue.title}{/}{/bold}\n` +
      `{#666-fg}─────────────────────────────────────────────────────{/}\n` +
      `{${statusColor}-fg}${statusIcon} ${loop.status.toUpperCase()}{/}  {#666-fg}│{/}  ` +
      `{#9b5de5-fg}Agent:{/} ${loop.agent}  {#666-fg}│{/}  ` +
      `{#9b5de5-fg}Time:{/} ${time}  {#666-fg}│{/}  ` +
      `{#9b5de5-fg}Issue:{/} #${loop.issue.number}\n\n`;

    if (loop.issue.acceptanceCriteria.length > 0) {
      content += `{#ffbe0b-fg}━━━ Acceptance Criteria ━━━{/}\n`;
      for (const ac of loop.issue.acceptanceCriteria) {
        const icon = ac.completed ? '{#00f5d4-fg}✓{/}' : '{#666-fg}○{/}';
        content += `  ${icon} ${ac.text}\n`;
      }
      content += '\n';
    }

    content += `{#2de2e6-fg}━━━ Actions ━━━{/}\n`;
    if (loop.status === 'running') {
      content += `  {#ff4fd8-fg}[P]{/} Pause  {#ff4fd8-fg}[S]{/} Stop  {#ff4fd8-fg}[I]{/} Intervene`;
    } else if (loop.status === 'paused') {
      content += `  {#ff4fd8-fg}[P]{/} Resume  {#ff4fd8-fg}[S]{/} Stop`;
    } else if (loop.status === 'queued') {
      content += `  {#ff4fd8-fg}[Enter]{/} Start  {#ff4fd8-fg}[S]{/} Delete`;
    } else {
      content += `  {#666-fg}Loop is ${loop.status}{/}`;
    }

    if (loop.error) {
      content += `\n\n{#ff006e-fg}Error: ${loop.error}{/}`;
    }

    detailWindow.setContent(content);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSCRIPT LOG
  // ═══════════════════════════════════════════════════════════════════════════
  const logWindow = blessed.log({
    parent: screen,
    label: ' {bold}{#9b5de5-fg}◆ LIVE TRANSCRIPT{/} ',
    tags: true,
    top: '50%+1',
    left: '30%',
    width: '70%-1',
    height: '50%-5',
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
  logWindow.on('focus', () => {
    setActivePane(logWindow);
    screen.render();
  });
  setActivePane(loopListWindow);

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

    logWindow.setContent('');
    logWindow.log('{#444-fg}════════════════════════════════════════════════════════════{/}');

    // Load recent logs
    const recentLogs = readRecentLogs(loopId, 50);
    for (const entry of recentLogs) {
      logWindow.log(formatLogEntry(entry));
    }

    // Start tailing
    logTailCleanup = tailLog(loopId, (entry) => {
      logWindow.log(formatLogEntry(entry));
      triggerBackgroundGlow(entry.type === 'error' ? 'error' : entry.type === 'system' ? 'system' : 'log');
      screen.render();
    });
  }

  logWithGlow('{#666-fg}[system]{/} Alex initialized. Press [N] to create a loop.', 'system');

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS BAR
  // ═══════════════════════════════════════════════════════════════════════════
  blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    style: { fg: 'white', bg: 'black', transparent: true },
    content: '\n {#ff4fd8-fg}[N]{/}ew {#ff4fd8-fg}[P]{/}ause {#ff4fd8-fg}[S]{/}top {#ff4fd8-fg}[I]{/}ntervene {#666-fg}│{/} {#2de2e6-fg}↑↓{/}Nav {#2de2e6-fg}Enter{/}Start {#666-fg}│{/} {#ff4fd8-fg}[Q]{/}uit',
  } as any);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP SELECTION HANDLER
  // ═══════════════════════════════════════════════════════════════════════════
  loopListWindow.on('select', (_item: any, index: number) => {
    const loop = state.loops[index];
    if (loop) {
      selectedLoopId = loop.id;
      updateDetailPane(loop);
      loadLogsForLoop(loop.id);
      screen.render();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW LOOP MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  screen.key(['n', 'N'], () => {
    let selectedAgent: 'claude' | 'codex' = 'claude';
    let skipPermissions = true;

    const modal = blessed.form({
      parent: screen,
      label: ' {bold}{#ff4fd8-fg}◆ NEW LOOP{/} ',
      tags: true,
      top: 'center',
      left: 'center',
      width: 70,
      height: 20,
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

    const input = blessed.textbox({
      parent: modal,
      top: 3,
      left: 2,
      width: 64,
      height: 3,
      border: 'line',
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' }, focus: { border: { fg: 'magenta' } } },
      inputOnFocus: true,
      mouse: true,
    } as any);

    blessed.text({
      parent: modal,
      top: 6,
      left: 2,
      tags: true,
      content: '{#eaeaea-fg}Paste local repo root:{/}',
    });

    const repoInput = blessed.textbox({
      parent: modal,
      top: 8,
      left: 2,
      width: 64,
      height: 3,
      border: 'line',
      style: { fg: 'white', bg: 'black', border: { fg: 'cyan' }, focus: { border: { fg: 'magenta' } } },
      inputOnFocus: true,
      mouse: true,
    } as any);
    repoInput.setValue(process.cwd());

    // Click to focus/edit textboxes
    input.on('click', () => {
      repoInput.cancel();
      input.focus();
      input.readInput(() => {});
    });
    repoInput.on('click', () => {
      input.cancel();
      repoInput.focus();
      repoInput.readInput(() => {});
    });

    // Tab to switch between inputs
    input.key(['tab'], () => {
      input.submit();
      repoInput.focus();
      repoInput.readInput(() => {});
    });
    repoInput.key(['tab'], () => {
      repoInput.submit();
      input.focus();
      input.readInput(() => {});
    });

    blessed.text({
      parent: modal,
      top: 12,
      left: 2,
      tags: true,
      content: '{#9b5de5-fg}Agent:{/}',
    });

    const claudeBtn = blessed.button({
      parent: modal,
      top: 12,
      left: 10,
      width: 12,
      height: 1,
      tags: true,
      content: '{#2de2e6-fg}[●]{/} Claude',
      mouse: true,
      style: { fg: 'white', bg: 'transparent', hover: { fg: 'cyan' } },
    } as any);

    const codexBtn = blessed.button({
      parent: modal,
      top: 12,
      left: 24,
      width: 11,
      height: 1,
      tags: true,
      content: '{#666-fg}[ ]{/} Codex',
      mouse: true,
      style: { fg: 'white', bg: 'transparent', hover: { fg: 'cyan' } },
    } as any);

    blessed.text({
      parent: modal,
      top: 14,
      left: 2,
      tags: true,
      content: '{#9b5de5-fg}Options:{/}',
    });

    const skipPermBtn = blessed.button({
      parent: modal,
      top: 14,
      left: 11,
      width: 22,
      height: 1,
      tags: true,
      content: '{#00f5d4-fg}[✓]{/} Skip permissions',
      mouse: true,
      style: { fg: 'white', bg: 'transparent', hover: { fg: 'cyan' } },
    } as any);

    function updateAgentButtons(): void {
      claudeBtn.setContent(selectedAgent === 'claude' ? '{#2de2e6-fg}[●]{/} Claude' : '{#666-fg}[ ]{/} Claude');
      codexBtn.setContent(selectedAgent === 'codex' ? '{#2de2e6-fg}[●]{/} Codex' : '{#666-fg}[ ]{/} Codex');
      screen.render();
    }

    function updateSkipPermBtn(): void {
      skipPermBtn.setContent(skipPermissions ? '{#00f5d4-fg}[✓]{/} Skip permissions' : '{#666-fg}[ ]{/} Skip permissions');
      screen.render();
    }

    claudeBtn.on('press', () => {
      selectedAgent = 'claude';
      updateAgentButtons();
    });

    codexBtn.on('press', () => {
      selectedAgent = 'codex';
      updateAgentButtons();
    });

    skipPermBtn.on('press', () => {
      skipPermissions = !skipPermissions;
      updateSkipPermBtn();
    });

    const createBtn = blessed.button({
      parent: modal,
      top: 16,
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
      top: 16,
      left: 20,
      width: 14,
      height: 3,
      content: '  Cancel  ',
      align: 'center',
      style: { fg: 'white', bg: 240, hover: { bg: 'red' } },
      mouse: true,
    } as any);

    const closeModal = (): void => {
      modal.destroy();
      loopListWindow.focus();
      screen.render();
    };

    const handleCreate = async (): Promise<void> => {
      const url = (input as any).getValue().trim();
      if (!url) {
        logWithGlow('{#ff006e-fg}[error]{/} Please enter a GitHub issue URL', 'error');
        screen.render();
        return;
      }

      const repoRootRaw = (repoInput as any).getValue().trim();
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

      closeModal();
      logWithGlow(`{#666-fg}[system]{/} Fetching issue from ${url}...`, 'system');
      screen.render();

      try {
        const issue = await fetchIssue(url);
        const loop = createLoop(issue, selectedAgent, skipPermissions, repoRoot);

        state = loadState();
        updateLoopList();
        updateHeader();

        // Select the new loop
        const idx = state.loops.findIndex(l => l.id === loop.id);
        if (idx >= 0) {
          loopListWindow.select(idx);
          loopListWindow.emit('select', null, idx);
        }

        logWithGlow(`{#00f5d4-fg}[system]{/} Loop created: ${issue.title}`, 'system');
        logWithGlow(`{#666-fg}[system]{/} Press Enter to start the loop`, 'system');
      } catch (err: any) {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
      }
      screen.render();
    };

    createBtn.on('press', handleCreate);
    cancelBtn.on('press', closeModal);
    input.key(['escape'], closeModal);
    repoInput.key(['escape'], closeModal);
    modal.key(['escape'], closeModal);

    // Manual focus control in case form tabbing is swallowed
    input.key(['tab'], () => {
      modal.focusNext();
      screen.render();
    });
    repoInput.key(['tab'], () => {
      modal.focusNext();
      screen.render();
    });
    input.key(['S-tab'], () => {
      modal.focusPrevious();
      screen.render();
    });
    repoInput.key(['S-tab'], () => {
      modal.focusPrevious();
      screen.render();
    });

    // Toggle permissions with Space (when not in input)
    modal.key(['space'], () => {
      if (screen.focused === input || screen.focused === repoInput) {
        return;
      }
      skipPermissions = !skipPermissions;
      updateSkipPermBtn();
    });

    input.focus();
    screen.render();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION KEYS
  // ═══════════════════════════════════════════════════════════════════════════

  // Enter - Start queued loop
  screen.key(['enter'], () => {
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (loop?.status === 'queued') {
      try {
        startLoop(loop.id);
        state = loadState();
        updateLoopList();
        updateHeader();
        updateDetailPane(state.loops.find(l => l.id === selectedLoopId)!);
        screen.render();
      } catch (err: any) {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        screen.render();
      }
    }
  });

  // P - Pause/Resume
  screen.key(['p', 'P'], () => {
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    try {
      if (loop.status === 'running') {
        pauseLoop(loop.id);
      } else if (loop.status === 'paused') {
        resumeLoop(loop.id);
      }
      state = loadState();
      updateLoopList();
      updateHeader();
      updateDetailPane(state.loops.find(l => l.id === selectedLoopId)!);
      screen.render();
    } catch (err: any) {
      logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
      screen.render();
    }
  });

  // S - Stop
  screen.key(['s', 'S'], () => {
    if (!selectedLoopId) return;
    const loop = state.loops.find(l => l.id === selectedLoopId);
    if (!loop) return;

    if (loop.status === 'running' || loop.status === 'paused') {
      try {
        stopLoop(loop.id);
        state = loadState();
        updateLoopList();
        updateHeader();
        updateDetailPane(state.loops.find(l => l.id === selectedLoopId)!);
        screen.render();
      } catch (err: any) {
        logWithGlow(`{#ff006e-fg}[error]{/} ${err.message}`, 'error');
        screen.render();
      }
    }
  });

  // I - Intervene
  screen.key(['i', 'I'], () => {
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

    input.key(['escape'], closeModal);
    input.focus();
    screen.render();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOP EVENTS - Update UI on state changes
  // ═══════════════════════════════════════════════════════════════════════════
  loopEvents.on('event', () => {
    state = loadState();
    updateLoopList();
    updateHeader();
    if (selectedLoopId) {
      const loop = state.loops.find(l => l.id === selectedLoopId);
      if (loop) updateDetailPane(loop);
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
  if (state.loops.length > 0) {
    loopListWindow.select(0);
    loopListWindow.emit('select', null, 0);
  }
  screen.render();
}

main();
