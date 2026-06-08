/**
 * Template variable utilities (Stage 3: Template Manager).
 *
 * WhatsApp/Meta templates use numbered placeholders like {{1}}, {{2}} inside the
 * header text, body and button URLs. These helpers extract those placeholders,
 * validate that a caller supplied every required parameter, and render a preview
 * by substituting values.
 */

const PLACEHOLDER_REGEX = /\{\{\s*([0-9]+)\s*\}\}/g;

export interface TemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
}

export interface TemplateLike {
  body: string;
  headerType?: string | null;
  headerText?: string | null;
  buttons?: unknown;
}

/**
 * Collect the text fragments of a template that may contain placeholders:
 * header text (only when header is a text header), body, and button URLs.
 */
function collectPlaceholderSources(template: TemplateLike): string[] {
  const sources: string[] = [template.body ?? ""];

  if (template.headerType === "text" && template.headerText) {
    sources.push(template.headerText);
  }

  const buttons = normalizeButtons(template.buttons);
  for (const button of buttons) {
    if (button.type === "URL" && button.url) {
      sources.push(button.url);
    }
  }

  return sources;
}

export function normalizeButtons(raw: unknown): TemplateButton[] {
  if (!Array.isArray(raw)) return [];
  return raw as TemplateButton[];
}

/**
 * Extract the unique, ascending list of placeholder tokens used by a template.
 * e.g. body "Hi {{1}}, your order {{2}} ships {{1}}" -> ["{{1}}", "{{2}}"]
 */
export function extractVariables(template: TemplateLike): string[] {
  const numbers = new Set<number>();

  for (const source of collectPlaceholderSources(template)) {
    for (const match of source.matchAll(PLACEHOLDER_REGEX)) {
      numbers.add(Number(match[1]));
    }
  }

  return Array.from(numbers)
    .sort((a, b) => a - b)
    .map((n) => `{{${n}}}`);
}

export interface ParameterValidationResult {
  valid: boolean;
  required: string[];
  provided: string[];
  missing: string[];
  unexpected: string[];
  /**
   * Meta requires placeholders to be strictly sequential starting at 1
   * ({{1}}, {{2}}, ...). A gap (e.g. {{1}}, {{3}}) is a structural error.
   */
  nonSequential: boolean;
}

/**
 * Validate a parameter map against the placeholders a template actually uses.
 * `parameters` is keyed by placeholder token, e.g. { "{{1}}": "Alice" }.
 */
export function validateTemplateParameters(
  template: TemplateLike,
  parameters: Record<string, string>
): ParameterValidationResult {
  const required = extractVariables(template);
  const provided = Object.keys(parameters);

  const requiredSet = new Set(required);
  const providedSet = new Set(provided);

  const missing = required.filter((token) => {
    const value = parameters[token];
    return value === undefined || value === null || value === "";
  });
  const unexpected = provided.filter((token) => !requiredSet.has(token));

  // Check the numeric sequence is 1..N with no gaps.
  const numbers = required.map((t) => Number(t.replace(/[^0-9]/g, "")));
  let nonSequential = false;
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== i + 1) {
      nonSequential = true;
      break;
    }
  }

  return {
    valid: missing.length === 0 && unexpected.length === 0 && !nonSequential,
    required,
    provided: Array.from(providedSet),
    missing,
    unexpected,
    nonSequential,
  };
}

/**
 * Render a preview of a template by substituting placeholder values.
 * Missing values fall back to the placeholder token itself so the gap is visible.
 */
export function renderTemplatePreview(
  template: TemplateLike,
  parameters: Record<string, string> = {}
): { header: string | null; body: string; buttons: TemplateButton[] } {
  const substitute = (text: string): string =>
    text.replace(PLACEHOLDER_REGEX, (_match, num) => {
      const token = `{{${num}}}`;
      return parameters[token] ?? token;
    });

  const header =
    template.headerType === "text" && template.headerText
      ? substitute(template.headerText)
      : null;

  const buttons = normalizeButtons(template.buttons).map((button) =>
    button.type === "URL" && button.url
      ? { ...button, url: substitute(button.url) }
      : button
  );

  return {
    header,
    body: substitute(template.body ?? ""),
    buttons,
  };
}
