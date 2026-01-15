import blessed from 'blessed';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { markTutorialCompleted } from './cli.js';
import { colors } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Animation frame type
type AnimationFrames = string[][];

// Load animation frames from JSON file
function loadAnimation(name: string): AnimationFrames {
  const animPath = path.join(__dirname, 'animations', `${name}.json`);
  const content = fs.readFileSync(animPath, 'utf-8');
  return JSON.parse(content) as AnimationFrames;
}

// Grayscale characters for animation rendering
const GRAYSCALE_CHARS = ' .:-=+*#%@';

// Map animation characters to grayscale intensity
function toGrayscale(char: string): string {
  // Keep space as space
  if (char === ' ') return ' ';
  // Map common ASCII art chars to grayscale
  const intensity = GRAYSCALE_CHARS.indexOf(char);
  if (intensity >= 0) return char;
  // Map other chars to mid-gray
  return ':';
}

// Render animation frame as grayscale text
function renderGrayscaleFrame(frame: string[], width: number, height: number): string {
  const lines: string[] = [];

  // Center the frame in the viewport
  const frameHeight = frame.length;
  const frameWidth = frame[0]?.length || 0;

  // If frame is taller than viewport, skip lines from top to center it
  const frameStartOffset = Math.max(0, Math.floor((frameHeight - height) / 2));
  // If frame is shorter than viewport, add padding at top
  const topPad = Math.max(0, Math.floor((height - frameHeight) / 2));
  const leftPad = Math.max(0, Math.floor((width - frameWidth) / 2));

  // Add top padding (only when frame is shorter than viewport)
  for (let i = 0; i < topPad; i++) {
    lines.push(' '.repeat(width));
  }

  // Render frame lines starting from offset (to center tall frames)
  for (let i = frameStartOffset; i < frameHeight && lines.length < height; i++) {
    const line = frame[i] || '';
    const grayscaleLine = Array.from(line).map(toGrayscale).join('');
    const paddedLine = ' '.repeat(leftPad) + grayscaleLine;
    lines.push(paddedLine.padEnd(width, ' ').slice(0, width));
  }

  // Fill remaining height
  while (lines.length < height) {
    lines.push(' '.repeat(width));
  }

  // Apply light gray color to entire frame (visible on black bg)
  return lines.map(line => `{#888-fg}${line}{/}`).join('\n');
}

// Helper to center a block of text both horizontally and vertically
function centerTextBlock(textLines: string[], width: number, height: number): string {
  const lines: string[] = [];

  // Find the longest line (without tags) to determine left padding for the block
  let maxLen = 0;
  for (const line of textLines) {
    const plainLen = line.replace(/\{[^}]+\}/g, '').length;
    if (plainLen > maxLen) maxLen = plainLen;
  }

  // Calculate padding
  const leftPad = Math.max(0, Math.floor((width - maxLen) / 2));
  const topPad = Math.max(0, Math.floor((height - textLines.length) / 2));

  // Add top padding
  for (let i = 0; i < topPad; i++) {
    lines.push('');
  }

  // Add text lines with left padding
  for (const line of textLines) {
    lines.push(' '.repeat(leftPad) + line);
  }

  // Fill remaining height
  while (lines.length < height) {
    lines.push('');
  }

  return lines.join('\n');
}

// Scene definitions
interface TutorialScene {
  id: string;
  render: (width: number, height: number, frame?: string[]) => string;
  hasAnimation?: boolean;
}

// Scene 1: Welcome with rocket animation
function renderWelcomeScene(width: number, height: number, frame?: string[]): string {
  const bgContent = frame ? renderGrayscaleFrame(frame, width, height) : '';

  // Build overlay text (centered - no hardcoded spaces)
  const overlayLines = [
    '',
    '',
    `{${colors.cyan}-fg}{bold}Welcome to ALEx{/bold}{/}`,
    `{${colors.pink}-fg}Another Loop Experience{/}`,
    '',
    `{#eaeaea-fg}Digital Materials Inc - Freeware Program{/}`,
    `{#eaeaea-fg}created by Alex Haynes{/}`,
    '',
    '',
    `{#666-fg}[Enter] Continue   [Esc] Skip tutorial{/}`,
  ];

  // Calculate vertical centering for overlay
  const overlayHeight = overlayLines.length;
  const startLine = Math.floor((height - overlayHeight) / 2);

  // If we have a background frame, overlay the text on it
  if (frame) {
    const bgLines = bgContent.split('\n');

    // Overlay text onto background
    for (let i = 0; i < overlayLines.length; i++) {
      const targetLine = startLine + i;
      if (targetLine >= 0 && targetLine < bgLines.length && overlayLines[i]) {
        // Center the overlay line
        const textLen = overlayLines[i].replace(/\{[^}]+\}/g, '').length;
        const leftPad = Math.max(0, Math.floor((width - textLen) / 2));
        // Replace portion of background with overlay text
        bgLines[targetLine] = ' '.repeat(leftPad) + overlayLines[i];
      }
    }

    return bgLines.join('\n');
  }

  // No animation, just return centered text
  const lines: string[] = [];
  for (let i = 0; i < height; i++) {
    if (i >= startLine && i < startLine + overlayHeight) {
      const textLen = overlayLines[i - startLine].replace(/\{[^}]+\}/g, '').length;
      const leftPad = Math.max(0, Math.floor((width - textLen) / 2));
      lines.push(' '.repeat(leftPad) + overlayLines[i - startLine]);
    } else {
      lines.push('');
    }
  }
  return lines.join('\n');
}

// Scene 2: Keybinds overview
function renderKeybindsScene(width: number, height: number): string {
  const lines = [
    `{${colors.pink}-fg}{bold}◆ KEYBINDS{/bold}{/}`,
    '',
    `{${colors.cyan}-fg}n{/}       Create new loop from GitHub issue`,
    `{${colors.cyan}-fg}Enter{/}   Start queued loop`,
    `{${colors.cyan}-fg}p{/}       Pause/Resume running loop`,
    `{${colors.cyan}-fg}s{/}       Stop loop`,
    `{${colors.cyan}-fg}r{/}       Retry errored loop`,
    `{${colors.cyan}-fg}i{/}       Intervene (send message to agent)`,
    `{${colors.cyan}-fg}c{/}       Mark complete / Close issue`,
    `{${colors.cyan}-fg}v{/}       Request review from alternate agent`,
    `{${colors.cyan}-fg}l{/}       View full log`,
    `{${colors.cyan}-fg}m{/}       Metrics dashboard`,
    `{${colors.cyan}-fg}h{/}       Hide loop`,
    `{${colors.cyan}-fg}q{/}       Quit`,
    '',
    `{${colors.purple}-fg}Tab 1-5{/}  Filter by status (All/Running/Paused/etc)`,
    '',
    '',
    `{#666-fg}[Enter] Continue   [Esc] Skip{/}`,
  ];
  return centerTextBlock(lines, width, height);
}

// Scene 3: Workflow concepts
function renderWorkflowScene(width: number, height: number): string {
  const lines = [
    `{${colors.pink}-fg}{bold}◆ HOW IT WORKS{/bold}{/}`,
    '',
    `{${colors.cyan}-fg}1.{/} Create a GitHub issue with acceptance criteria`,
    `{${colors.cyan}-fg}2.{/} Press {${colors.cyan}-fg}[n]{/} and paste the issue URL`,
    `{${colors.cyan}-fg}3.{/} ALEx spawns an AI agent in a git worktree`,
    `{${colors.cyan}-fg}4.{/} Agent works autonomously toward criteria`,
    `{${colors.cyan}-fg}5.{/} Monitor progress, intervene if stuck`,
    `{${colors.cyan}-fg}6.{/} Review completed work, close the issue`,
    '',
    `{${colors.pink}-fg}{bold}◆ TIPS{/bold}{/}`,
    '',
    `{${colors.purple}-fg}•{/} Clear acceptance criteria = better results`,
    `{${colors.purple}-fg}•{/} Use {${colors.cyan}-fg}[i]{/} to course-correct running loops`,
    `{${colors.purple}-fg}•{/} Request {${colors.cyan}-fg}[v]{/} review from different agent`,
    `{${colors.purple}-fg}•{/} Hidden loops still run in background`,
    '',
    '',
    `{#666-fg}[Enter] Start using ALEx   [Esc] Skip{/}`,
  ];
  return centerTextBlock(lines, width, height);
}

// All scenes
const SCENES: TutorialScene[] = [
  { id: 'welcome', render: renderWelcomeScene, hasAnimation: true },
  { id: 'keybinds', render: renderKeybindsScene },
  { id: 'workflow', render: renderWorkflowScene },
];

/**
 * Run the tutorial presentation
 */
export function runTutorial(screen: blessed.Widgets.Screen): Promise<void> {
  return new Promise((resolve) => {
    let currentSceneIndex = 0;
    let animationInterval: ReturnType<typeof setInterval> | null = null;
    let animationFrames: AnimationFrames = [];
    let currentFrame = 0;

    // Load rocket animation
    try {
      animationFrames = loadAnimation('rocket');
    } catch (err) {
      // Animation not found, continue without
    }

    // Create fullscreen overlay
    const overlay = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      tags: true,
      style: {
        fg: 'white',
        bg: 'black',
      },
    } as any);

    const width = (screen.width as number) || 80;
    const height = (screen.height as number) || 24;

    // Render current scene
    const renderScene = (): void => {
      const scene = SCENES[currentSceneIndex];
      if (!scene) return;

      let content: string;
      if (scene.hasAnimation && animationFrames.length > 0) {
        const frame = animationFrames[currentFrame % animationFrames.length];
        content = scene.render(width, height, frame);
      } else {
        content = scene.render(width, height);
      }

      overlay.setContent(content);
      screen.render();
    };

    // Start animation for current scene
    const startAnimation = (): void => {
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }

      const scene = SCENES[currentSceneIndex];
      if (scene?.hasAnimation && animationFrames.length > 0) {
        currentFrame = 0;
        animationInterval = setInterval(() => {
          currentFrame++;
          renderScene();
        }, 100); // ~10fps
      }
    };

    // Stop animation
    const stopAnimation = (): void => {
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }
    };

    // Navigate to next scene
    const nextScene = (): void => {
      stopAnimation();
      currentSceneIndex++;

      if (currentSceneIndex >= SCENES.length) {
        // Tutorial complete
        cleanup();
        markTutorialCompleted();
        resolve();
        return;
      }

      startAnimation();
      renderScene();
    };

    // Skip tutorial
    const skipTutorial = (): void => {
      stopAnimation();
      cleanup();
      markTutorialCompleted();
      resolve();
    };

    // Cleanup
    const cleanup = (): void => {
      stopAnimation();
      overlay.destroy();
    };

    // Key handlers
    overlay.key(['enter', 'space'], nextScene);
    overlay.key(['escape', 'q'], skipTutorial);

    // Handle resize
    screen.on('resize', () => {
      renderScene();
    });

    // Start
    overlay.focus();
    startAnimation();
    renderScene();
  });
}
