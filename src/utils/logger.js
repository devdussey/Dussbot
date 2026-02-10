const util = require('node:util');

const LEVELS = {
  info: { label: 'INFO', color: '\u001b[36m', output: 'log' },
  success: { label: 'SUCCESS', color: '\u001b[32m', output: 'log' },
  warn: { label: 'WARN', color: '\u001b[33m', output: 'warn' },
  error: { label: 'ERROR', color: '\u001b[31m', output: 'error' },
  debug: { label: 'DEBUG', color: '\u001b[35m', output: 'log' },
};
const RESET = '\u001b[0m';
const shouldColorize = process.env.LOG_NO_COLOR !== '1' && process.stdout?.isTTY;

function formatValue(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value;
  }
  return util.inspect(value, { depth: 4, colors: shouldColorize, compact: false });
}

function formatArgs(args) {
  return args.map(formatValue).join(' ');
}

function formatLevelTag(levelMeta) {
  const tag = `[${levelMeta.label}]`;
  if (shouldColorize) {
    return `${levelMeta.color}${tag}${RESET}`;
  }
  return tag;
}

function buildLine(levelMeta, label, body) {
  const timestamp = new Date().toISOString();
  const labelPart = label ? ` [${label}]` : '';
  const suffix = body ? ` ${body}` : '';
  return `${timestamp} ${formatLevelTag(levelMeta)}${labelPart}${suffix}`;
}

function log(level, label, args) {
  const levelMeta = LEVELS[level] || LEVELS.info;
  const body = formatArgs(args);
  const line = buildLine(levelMeta, label, body);
  const method = console[levelMeta.output] || console.log;
  method(line);
}

function createLogger(label = null) {
  return {
    info: (...args) => log('info', label, args),
    success: (...args) => log('success', label, args),
    warn: (...args) => log('warn', label, args),
    error: (...args) => log('error', label, args),
    debug: (...args) => log('debug', label, args),
  };
}

const defaultLogger = createLogger();

function logger(label) {
  if (!label) return defaultLogger;
  return createLogger(label);
}

Object.assign(logger, defaultLogger, { child: createLogger });

module.exports = logger;
