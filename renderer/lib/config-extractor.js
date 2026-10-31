/**
 * Extract compositionConfig from a TSX file
 *
 * Based on pattern from remotion/scripts/composition-watcher.js
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationInSeconds: 5,
};

/**
 * Minimal, safe parser for object/array literals.
 *
 * Composition configs are plain data (`{ id: 'x', fps: 30, defaultProps: {...} }`),
 * so there is no need to `eval()` user code (which could run anything). This
 * supports objects, arrays, strings, numbers, booleans, null and nested values,
 * and throws on anything else so the caller can fall back to regex extraction.
 */
function parseLiteral(source) {
  const text = String(source);
  let index = 0;

  const fail = (message) => {
    throw new Error(`${message} at ${index}`);
  };

  const skipSpace = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };

  const parseString = () => {
    const quote = text[index];
    index += 1;
    let out = '';
    while (index < text.length) {
      const ch = text[index];
      if (ch === '\\') {
        const next = text[index + 1];
        const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
        if (next === 'u') {
          const hex = text.slice(index + 2, index + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad unicode escape');
          out += String.fromCharCode(parseInt(hex, 16));
          index += 6;
          continue;
        }
        out += escapes[next] !== undefined ? escapes[next] : next;
        index += 2;
        continue;
      }
      if (ch === quote) {
        index += 1;
        if (quote === '`' && out.includes('${')) fail('template interpolation is not literal data');
        return out;
      }
      out += ch;
      index += 1;
    }
    return fail('unterminated string');
  };

  const parseValue = () => {
    skipSpace();
    const ch = text[index];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"' || ch === "'" || ch === '`') return parseString();
    const rest = text.slice(index);
    const numberMatch = rest.match(/^-?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/);
    if (numberMatch) {
      index += numberMatch[0].length;
      const raw = numberMatch[0];
      return /^0[xX]/.test(raw) ? parseInt(raw, 16) : Number(raw);
    }
    const wordMatch = rest.match(/^[A-Za-z_$][\w$]*/);
    if (wordMatch) {
      index += wordMatch[0].length;
      if (wordMatch[0] === 'true') return true;
      if (wordMatch[0] === 'false') return false;
      if (wordMatch[0] === 'null') return null;
      if (wordMatch[0] === 'undefined') return undefined;
      return fail(`unsupported identifier "${wordMatch[0]}"`);
    }
    return fail('unexpected token');
  };

  const parseObject = () => {
    index += 1; // {
    const result = {};
    skipSpace();
    if (text[index] === '}') {
      index += 1;
      return result;
    }
    for (;;) {
      skipSpace();
      let key;
      if (text[index] === '"' || text[index] === "'" || text[index] === '`') {
        key = parseString();
      } else {
        const keyMatch = text.slice(index).match(/^[A-Za-z_$][\w$]*|^\d+/);
        if (!keyMatch) fail('invalid key');
        key = keyMatch[0];
        index += key.length;
      }
      skipSpace();
      if (text[index] !== ':') fail('expected ":"');
      index += 1;
      result[key] = parseValue();
      skipSpace();
      if (text[index] === ',') {
        index += 1;
        skipSpace();
        if (text[index] === '}') {
          index += 1;
          return result;
        }
        continue;
      }
      if (text[index] === '}') {
        index += 1;
        return result;
      }
      fail('expected "," or "}"');
    }
  };

  const parseArray = () => {
    index += 1; // [
    const result = [];
    skipSpace();
    if (text[index] === ']') {
      index += 1;
      return result;
    }
    for (;;) {
      result.push(parseValue());
      skipSpace();
      if (text[index] === ',') {
        index += 1;
        skipSpace();
        if (text[index] === ']') {
          index += 1;
          return result;
        }
        continue;
      }
      if (text[index] === ']') {
        index += 1;
        return result;
      }
      fail('expected "," or "]"');
    }
  };

  const value = parseValue();
  skipSpace();
  if (index !== text.length) fail('trailing characters');
  return value;
}

/**
 * Extract compositionConfig from a TSX file using regex
 * @param {string} filePath - Absolute path to TSX file
 * @returns {Object} Configuration object
 */
function extractCompositionConfig(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath, '.tsx');

  // Try to find compositionConfig export (same regex as composition-watcher.js)
  const configMatch = content.match(
    /export\s+const\s+compositionConfig\s*=\s*(\{[\s\S]*?\});/
  );

  if (!configMatch) {
    throw new Error(
      `No compositionConfig found in ${filename}.tsx\n` +
      'Your file must export a compositionConfig object.'
    );
  }

  try {
    // Clean up the config string before parsing
    const configStr = configMatch[1]
      .replace(/\/\/.*$/gm, '')           // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');  // Remove multi-line comments

    // Safe literal parsing (no eval of user code)
    const config = parseLiteral(configStr);

    // Validate and return with defaults
    return {
      id: config.id || filename,
      durationInSeconds: config.durationInSeconds || DEFAULTS.durationInSeconds,
      fps: config.fps || DEFAULTS.fps,
      width: config.width || DEFAULTS.width,
      height: config.height || DEFAULTS.height,
      defaultProps: config.defaultProps || {},
    };
  } catch (evalError) {
    // If eval fails, try to extract values with more specific regexes
    const configStr = configMatch[1];
    const id = extractValue(configStr, 'id') || filename;
    const durationInSeconds = parseFloat(extractValue(configStr, 'durationInSeconds')) || DEFAULTS.durationInSeconds;
    const fps = parseInt(extractValue(configStr, 'fps')) || DEFAULTS.fps;
    const width = parseInt(extractValue(configStr, 'width')) || DEFAULTS.width;
    const height = parseInt(extractValue(configStr, 'height')) || DEFAULTS.height;

    return { id, durationInSeconds, fps, width, height, defaultProps: {} };
  }
}

/**
 * Extract a specific value from a config string using regex
 */
function extractValue(configStr, key) {
  // Match patterns like: key: 'value', key: "value", key: 123
  const patterns = [
    new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`),  // String value
    new RegExp(`${key}\\s*:\\s*(\\d+\\.?\\d*)`),    // Numeric value
  ];

  for (const pattern of patterns) {
    const match = configStr.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Detect the export style of a composition file
 * @param {string} filePath - Path to TSX file
 * @returns {Object} Export style info { type: 'default'|'named', name?: string }
 */
function detectExportStyle(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath, '.tsx');

  // Check for default export
  if (/export\s+default/.test(content)) {
    return { type: 'default', name: null };
  }

  // Check for named exports that look like React components (PascalCase)
  const namedExportMatches = content.matchAll(
    /export\s+(?:const|function)\s+([A-Z][a-zA-Z0-9]*)/g
  );

  for (const match of namedExportMatches) {
    const name = match[1];
    if (name !== 'compositionConfig') {
      return { type: 'named', name };
    }
  }

  // Fallback to filename-based component name
  return { type: 'named', name: filename };
}

module.exports = {
  extractCompositionConfig,
  detectExportStyle,
  parseLiteral,
};
