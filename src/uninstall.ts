import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import blessed from 'blessed';

// Load animation frames
const animationPath = path.join(import.meta.dir, 'animations', 'rain.json');
let frames: string[][] = [];
try {
  frames = JSON.parse(fs.readFileSync(animationPath, 'utf-8'));
} catch {
  frames = [['  (rain animation not found)']];
}

// Tile a frame to fill the screen
function tileFrame(frame: string[], screenWidth: number, screenHeight: number): string {
  const frameWidth = frame[0]?.length || 1;
  const frameHeight = frame.length || 1;
  const tilesX = Math.ceil(screenWidth / frameWidth) + 1;
  const tilesY = Math.ceil(screenHeight / frameHeight) + 1;

  const tiledLines: string[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let ly = 0; ly < frameHeight && tiledLines.length < screenHeight; ly++) {
      const line = frame[ly] || '';
      tiledLines.push(line.repeat(tilesX).slice(0, screenWidth));
    }
  }
  return tiledLines.slice(0, screenHeight).join('\n');
}

const ALEX_DIR = path.join(os.homedir(), '.alex');

interface UninstallResult {
  cancelled: boolean;
  dataDeleted: boolean;
  linkRemoved: boolean;
  errors: string[];
}

export async function runUninstallWizard(dryRun: boolean = false): Promise<void> {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'alex uninstall',
    fullUnicode: true,
  });

  const colors = {
    bg: '#0b0b0f',
    text: '#eaeaea',
    textDim: '#666666',
    pink: '#ff4fd8',
    cyan: '#2de2e6',
    red: '#ff006e',
    border: '#444444',
  };

  // Background
  const bg = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    style: { bg: colors.bg },
  });

  // Animation box (background, grayscale)
  const animBox = blessed.box({
    parent: bg,
    top: 0,
    left: 'center',
    width: '100%',
    height: '100%',
    align: 'center',
    valign: 'middle',
    tags: true,
    style: { fg: '#333333', bg: colors.bg },
  });

  // Message box
  const msgBox = blessed.box({
    parent: screen,
    bottom: 12,
    left: 'center',
    width: 60,
    height: 5,
    align: 'center',
    valign: 'middle',
    tags: true,
    transparent: true,
    style: { fg: colors.text, transparent: true },
  });

  // Button container
  const buttonContainer = blessed.box({
    parent: screen,
    bottom: 4,
    left: 'center',
    width: 50,
    height: 5,
    transparent: true,
  });

  // Yes button
  const yesBtn = blessed.button({
    parent: buttonContainer,
    left: 5,
    width: 16,
    height: 3,
    content: '  Yes, delete  ',
    align: 'center',
    tags: true,
    transparent: true,
    style: {
      fg: colors.text,
      transparent: true,
      border: { fg: colors.red },
      hover: { bg: colors.red, fg: '#ffffff' },
      focus: { bg: colors.red, fg: '#ffffff' },
    },
    border: { type: 'line' },
    mouse: true,
    keys: true,
  } as any);

  // No button
  const noBtn = blessed.button({
    parent: buttonContainer,
    right: 5,
    width: 16,
    height: 3,
    content: '    Cancel    ',
    align: 'center',
    tags: true,
    transparent: true,
    style: {
      fg: colors.text,
      transparent: true,
      border: { fg: colors.cyan },
      hover: { bg: colors.cyan, fg: '#000000' },
      focus: { bg: colors.cyan, fg: '#000000' },
    },
    border: { type: 'line' },
    mouse: true,
    keys: true,
  } as any);

  // State
  let confirmCount = 0;
  let frameIndex = 0;
  let animInterval: ReturnType<typeof setInterval> | null = null;

  // Animation loop (tiled rain background)
  function startAnimation() {
    const width = (screen.width as number) || 80;
    const height = (screen.height as number) || 24;
    animInterval = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      const frame = frames[frameIndex];
      const tiled = tileFrame(frame, width, height);
      animBox.setContent(`{#ffffff-fg}${tiled}{/}`);
      screen.render();
    }, 100);
  }

  function stopAnimation() {
    if (animInterval) {
      clearInterval(animInterval);
      animInterval = null;
    }
  }

  // Update message based on confirm count
  function updateMessage() {
    const dryRunTag = dryRun ? `{${colors.cyan}-fg}[DRY RUN]{/} ` : '';
    if (confirmCount === 0) {
      msgBox.setContent(
        `${dryRunTag}{bold}{${colors.red}-fg}UNINSTALL ALEX{/}\n\n` +
        `This will delete {bold}~/.alex{/} and remove the bun link.\n` +
        `{${colors.textDim}-fg}Are you sure?{/}`
      );
      yesBtn.setContent('  Yes, delete  ');
    } else if (confirmCount === 1) {
      msgBox.setContent(
        `${dryRunTag}{bold}{${colors.red}-fg}ARE YOU REALLY SURE?{/}\n\n` +
        `{${colors.pink}-fg}All loops, configs, and worktrees will be lost forever.{/}\n` +
        `{${colors.textDim}-fg}${dryRun ? 'This is a dry run - nothing will be deleted.' : 'This cannot be undone.'}{/}`
      );
      yesBtn.setContent(' Yes, I\'m sure ');
    }
    screen.render();
  }

  // Perform uninstall
  async function performUninstall(): Promise<UninstallResult> {
    const result: UninstallResult = {
      cancelled: false,
      dataDeleted: false,
      linkRemoved: false,
      errors: [],
    };

    // Delete ~/.alex
    try {
      if (fs.existsSync(ALEX_DIR)) {
        if (dryRun) {
          result.dataDeleted = true; // Would delete
        } else {
          fs.rmSync(ALEX_DIR, { recursive: true, force: true });
          result.dataDeleted = true;
        }
      } else {
        result.dataDeleted = true; // Already gone
      }
    } catch (err) {
      result.errors.push(`Failed to delete ${ALEX_DIR}: ${err}`);
    }

    // Remove bun link
    try {
      if (dryRun) {
        result.linkRemoved = true; // Would unlink
      } else {
        const unlinkResult = spawnSync('bun', ['unlink'], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        if (unlinkResult.status === 0) {
          result.linkRemoved = true;
        } else {
          result.errors.push(`bun unlink: ${unlinkResult.stderr || 'failed'}`);
        }
      }
    } catch (err) {
      result.errors.push(`Failed to run bun unlink: ${err}`);
    }

    return result;
  }

  // Show result screen
  function showResult(result: UninstallResult) {
    stopAnimation();
    buttonContainer.hide();

    const width = (screen.width as number) || 80;
    const height = (screen.height as number) || 24;

    if (result.cancelled) {
      const tiled = tileFrame(frames[0], width, height);
      animBox.setContent(`{#ffffff-fg}${tiled}{/}`);
      msgBox.setContent(
        `{bold}{${colors.cyan}-fg}Cancelled{/}\n\n` +
        `alex lives another day.`
      );
    } else {
      const tiled = tileFrame(frames[Math.min(2, frames.length - 1)], width, height);
      animBox.setContent(`{#ffffff-fg}${tiled}{/}`);

      let status = '';
      const wouldHave = dryRun ? 'Would delete' : 'Deleted';
      const wouldRemove = dryRun ? 'Would remove' : 'Removed';

      if (result.dataDeleted) {
        status += `{green-fg}✓{/} ${wouldHave} ~/.alex\n`;
      } else {
        status += `{red-fg}✗{/} Failed to delete ~/.alex\n`;
      }
      if (result.linkRemoved) {
        status += `{green-fg}✓{/} ${wouldRemove} bun link\n`;
      } else {
        status += `{yellow-fg}⚠{/} Could not remove bun link\n`;
      }

      if (result.errors.length > 0) {
        status += `\n{${colors.textDim}-fg}${result.errors.join('\n')}{/}`;
      }

      const title = dryRun
        ? `{bold}{${colors.cyan}-fg}[DRY RUN] Complete{/}`
        : `{bold}{${colors.pink}-fg}Goodbye...{/}`;

      msgBox.setContent(`${title}\n\n${status}`);
    }

    // Exit hint
    const exitHint = blessed.box({
      parent: screen,
      bottom: 2,
      left: 'center',
      width: 30,
      height: 1,
      align: 'center',
      content: `{${colors.textDim}-fg}Press any key to exit{/}`,
      tags: true,
      style: { bg: colors.bg },
    });

    screen.render();

    const exitHandler = () => {
      screen.destroy();
      process.exit(0);
    };
    screen.key('escape', exitHandler);
    screen.key('q', exitHandler);
    screen.key('enter', exitHandler);
    screen.key('space', exitHandler);
  }

  // Button handlers
  yesBtn.on('press', async () => {
    confirmCount++;
    if (confirmCount >= 2) {
      // Perform uninstall
      msgBox.setContent(`{${colors.textDim}-fg}Uninstalling...{/}`);
      yesBtn.hide();
      noBtn.hide();
      screen.render();

      const result = await performUninstall();
      showResult(result);
    } else {
      updateMessage();
    }
  });

  noBtn.on('press', () => {
    showResult({ cancelled: true, dataDeleted: false, linkRemoved: false, errors: [] });
  });

  // Key bindings
  const cancelHandler = () => {
    showResult({ cancelled: true, dataDeleted: false, linkRemoved: false, errors: [] });
  };
  screen.key('escape', cancelHandler);
  screen.key('q', cancelHandler);

  let focusedBtn: 'yes' | 'no' = 'no';

  const toggleFocus = () => {
    if (focusedBtn === 'yes') {
      focusedBtn = 'no';
      noBtn.focus();
    } else {
      focusedBtn = 'yes';
      yesBtn.focus();
    }
    screen.render();
  };

  screen.key('tab', toggleFocus);
  screen.key('left', toggleFocus);
  screen.key('right', toggleFocus);

  yesBtn.on('focus', () => { focusedBtn = 'yes'; });
  noBtn.on('focus', () => { focusedBtn = 'no'; });

  screen.key('enter', () => {
    if (focusedBtn === 'yes') {
      (yesBtn as any).press();
    } else {
      (noBtn as any).press();
    }
  });

  // Start
  noBtn.focus();
  startAnimation();
  updateMessage();
  screen.render();
}
