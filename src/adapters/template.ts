import { TemplateContext } from './schema.js';

/**
 * Simple template engine supporting:
 * - {{variable}} - variable substitution
 * - {{#condition}}content{{/condition}} - conditional blocks (include if truthy)
 * - {{^condition}}content{{/condition}} - inverse conditional (include if falsy)
 * - {{#array}}{{.}}{{/array}} - simple array iteration
 */

type ContextValue = string | boolean | undefined | string[];

function getContextValue(context: TemplateContext, key: string): ContextValue {
  return (context as unknown as Record<string, ContextValue>)[key];
}

function isTruthy(value: ContextValue): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function processArrays(template: string, context: TemplateContext): string {
  // Match {{#arrayKey}}...{{.}}...{{/arrayKey}} for array iteration
  const regex = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

  return template.replace(regex, (match, key, content) => {
    const value = getContextValue(context, key);
    if (Array.isArray(value)) {
      return value.map(item => content.replace(/\{\{\.\}\}/g, String(item))).join('');
    }
    return match; // Not an array, leave for conditional processing
  });
}

function processConditionals(template: string, context: TemplateContext): string {
  // Match {{#key}}content{{/key}}
  const regex = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

  return template.replace(regex, (_, key, content) => {
    const value = getContextValue(context, key);
    return isTruthy(value) ? content : '';
  });
}

function processInverseConditionals(template: string, context: TemplateContext): string {
  // Match {{^key}}content{{/key}}
  const regex = /\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

  return template.replace(regex, (_, key, content) => {
    const value = getContextValue(context, key);
    return !isTruthy(value) ? content : '';
  });
}

function processVariables(template: string, context: TemplateContext): string {
  // Match {{key}}
  const regex = /\{\{(\w+)\}\}/g;

  return template.replace(regex, (_, key) => {
    const value = getContextValue(context, key);
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  });
}

/**
 * Render a template string with the given context.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  let result = template;

  // Process arrays first (they use similar syntax to conditionals)
  result = processArrays(result, context);

  // Process conditional blocks: {{#key}}...{{/key}}
  result = processConditionals(result, context);

  // Process inverse conditionals: {{^key}}...{{/key}}
  result = processInverseConditionals(result, context);

  // Process variable substitution: {{key}}
  result = processVariables(result, context);

  return result.trim();
}

/**
 * Render an array of argument templates, filtering out empty results.
 */
export function renderArgs(templates: string[], context: TemplateContext): string[] {
  return templates
    .map(t => renderTemplate(t, context))
    .filter(arg => arg.length > 0);
}
