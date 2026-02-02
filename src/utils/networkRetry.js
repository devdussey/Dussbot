const RETRYABLE_NETWORK_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET_TIMEOUT',
  'UND_ERR_CONNECT_RESET',
  'ECONNRESET',
  'EPIPE',
]);
const RETRYABLE_MESSAGE_PATTERNS = [
  /connect timeout/i,
  /timed out/i,
  /connection reset/i,
  /socket hang up/i,
];

const DEFAULT_NETWORK_RETRY_OPTIONS = {
  retries: 2,
  delayMs: 600,
  backoffFactor: 1.5,
};

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractErrorCode(err) {
  if (!err) return null;
  return err.code || err.status || err.cause?.code || null;
}

function isRetryableNetworkError(err) {
  if (!err) return false;
  const code = extractErrorCode(err);
  if (code && RETRYABLE_NETWORK_CODES.has(code)) return true;
  const message = String(err.message || err).trim();
  return RETRYABLE_MESSAGE_PATTERNS.some(pattern => pattern.test(message));
}

async function retryAsync(operation, options = {}) {
  const {
    retries = DEFAULT_NETWORK_RETRY_OPTIONS.retries,
    delayMs = DEFAULT_NETWORK_RETRY_OPTIONS.delayMs,
    backoffFactor = DEFAULT_NETWORK_RETRY_OPTIONS.backoffFactor,
  } = options;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isRetryableNetworkError(err)) {
        throw err;
      }
      const waitTime = Math.round(delayMs * Math.pow(backoffFactor, attempt - 1));
      await wait(waitTime);
    }
  }
}

async function retryFetch(fetchFn, url, fetchOptions = {}, retryOptions = {}) {
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch function is required for retryFetch');
  }
  return retryAsync(() => fetchFn(url, fetchOptions), retryOptions);
}

module.exports = {
  DEFAULT_NETWORK_RETRY_OPTIONS,
  retryAsync,
  retryFetch,
};
