import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import { AdapterConfig } from './schema.js';
import { AgentAdapter } from './base.js';
import { createCustomAdapter } from './factory.js';

// Get directory of this module for bundled adapters
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config directory paths (priority: bundled < global < local)
const BUNDLED_ADAPTERS_DIR = path.join(__dirname, 'builtin');
const GLOBAL_ADAPTERS_DIR = path.join(process.env.HOME || '~', '.alex', 'adapters');
const LOCAL_ADAPTERS_DIR = path.join(process.cwd(), '.alex', 'adapters');

export interface LoadError {
  file: string;
  error: string;
}

export interface LoadResult {
  adapters: Map<string, AgentAdapter>;
  errors: LoadError[];
}

/**
 * Get the paths to adapter config directories (for watching).
 * Note: bundled adapters are not watched since they're part of the package.
 */
export function getConfigPaths(): string[] {
  return [GLOBAL_ADAPTERS_DIR, LOCAL_ADAPTERS_DIR];
}

/**
 * Get path to bundled adapters directory.
 */
export function getBundledPath(): string {
  return BUNDLED_ADAPTERS_DIR;
}

/**
 * Load all adapter configs from bundled, global, and local directories.
 * Priority: bundled < global < local (later overrides earlier).
 */
export function loadCustomAdapters(): LoadResult {
  const adapters = new Map<string, AgentAdapter>();
  const errors: LoadError[] = [];

  // Load bundled adapters first (lowest priority, can be overridden)
  const bundledConfigs = loadFromDirectory(BUNDLED_ADAPTERS_DIR, errors);
  for (const [name, config] of bundledConfigs) {
    try {
      adapters.set(name, createCustomAdapter(config));
    } catch (err) {
      errors.push({ file: `${BUNDLED_ADAPTERS_DIR}/${name}`, error: String(err) });
    }
  }

  // Load global configs (override bundled)
  const globalConfigs = loadFromDirectory(GLOBAL_ADAPTERS_DIR, errors);
  for (const [name, config] of globalConfigs) {
    try {
      adapters.set(name, createCustomAdapter(config));
    } catch (err) {
      errors.push({ file: `${GLOBAL_ADAPTERS_DIR}/${name}`, error: String(err) });
    }
  }

  // Load local configs (override global)
  const localConfigs = loadFromDirectory(LOCAL_ADAPTERS_DIR, errors);
  for (const [name, config] of localConfigs) {
    try {
      adapters.set(name, createCustomAdapter(config));
    } catch (err) {
      errors.push({ file: `${LOCAL_ADAPTERS_DIR}/${name}`, error: String(err) });
    }
  }

  return { adapters, errors };
}

function loadFromDirectory(
  dir: string,
  errors: LoadError[]
): Map<string, AdapterConfig> {
  const configs = new Map<string, AdapterConfig>();

  if (!fs.existsSync(dir)) {
    return configs;
  }

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return configs;
  }

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.yaml' && ext !== '.yml' && ext !== '.json') {
      continue;
    }

    const filePath = path.join(dir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = ext === '.json' ? JSON.parse(content) : parseYaml(content);

      const validation = validateConfig(config);
      if (!validation.valid) {
        errors.push({ file: filePath, error: validation.error! });
        continue;
      }

      configs.set(config.name, config as AdapterConfig);
    } catch (err) {
      errors.push({ file: filePath, error: `Parse error: ${err}` });
    }
  }

  return configs;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function validateConfig(config: unknown): ValidationResult {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Config must be an object' };
  }

  const c = config as Record<string, unknown>;

  // Required: name
  if (typeof c.name !== 'string' || !c.name.trim()) {
    return { valid: false, error: 'Missing or invalid "name" field' };
  }

  // Validate name format (alphanumeric, hyphen, underscore, must start with letter)
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c.name)) {
    return { valid: false, error: 'Name must start with letter, contain only alphanumeric, hyphen, underscore' };
  }

  // Required: command
  if (typeof c.command !== 'string' || !c.command.trim()) {
    return { valid: false, error: 'Missing or invalid "command" field' };
  }

  // Required: availability
  if (!c.availability || typeof c.availability !== 'object') {
    return { valid: false, error: 'Missing "availability" section' };
  }
  const avail = c.availability as Record<string, unknown>;
  if (!['which', 'exec', 'exists'].includes(avail.check as string)) {
    return { valid: false, error: 'availability.check must be "which", "exec", or "exists"' };
  }

  // Required: spawn
  if (!c.spawn || typeof c.spawn !== 'object') {
    return { valid: false, error: 'Missing "spawn" section' };
  }
  const spawn = c.spawn as Record<string, unknown>;
  if (!Array.isArray(spawn.args)) {
    return { valid: false, error: 'spawn.args must be an array' };
  }

  // Required: continue
  if (!c.continue || typeof c.continue !== 'object') {
    return { valid: false, error: 'Missing "continue" section' };
  }
  const cont = c.continue as Record<string, unknown>;
  if (!Array.isArray(cont.args)) {
    return { valid: false, error: 'continue.args must be an array' };
  }

  // Required: sessionExtraction
  if (!c.sessionExtraction || typeof c.sessionExtraction !== 'object') {
    return { valid: false, error: 'Missing "sessionExtraction" section' };
  }
  const sess = c.sessionExtraction as Record<string, unknown>;
  if (!Array.isArray(sess.patterns) || sess.patterns.length === 0) {
    return { valid: false, error: 'sessionExtraction.patterns must be a non-empty array' };
  }

  // Validate regex patterns are valid
  for (const pattern of sess.patterns as string[]) {
    try {
      new RegExp(pattern);
    } catch {
      return { valid: false, error: `Invalid regex pattern: ${pattern}` };
    }
  }

  return { valid: true };
}
