const logger = require('./logger')('Healthchecks');
const { retryFetch } = require('./networkRetry');

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 15_000;
const DEFAULT_FAILURE_LOG_EVERY = 10;

function parseInterval(raw) {
  const value = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(value, MIN_INTERVAL_MS);
}

function parseBool(raw, fallback = false) {
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (!value) return fallback;
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function parsePositiveInt(raw, fallback, minimum = 1) {
  const value = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(value) || value < minimum) return fallback;
  return value;
}

function getConfig() {
  return {
    pingUrl: String(process.env.HEALTHCHECKS_PING_URL || '').trim(),
    intervalMs: parseInterval(process.env.HEALTHCHECKS_PING_INTERVAL_MS),
    pingOnStart: parseBool(process.env.HEALTHCHECKS_PING_ON_START, true),
    failureLogEvery: parsePositiveInt(
      process.env.HEALTHCHECKS_FAILURE_LOG_EVERY,
      DEFAULT_FAILURE_LOG_EVERY,
      1,
    ),
  };
}

let heartbeatTimer = null;
let installed = false;
let consecutiveFailures = 0;
let loggedFailureEvents = 0;

function markPingFailure(reason, detail, failureLogEvery) {
  consecutiveFailures += 1;
  const shouldLog =
    consecutiveFailures === 1
    || consecutiveFailures % failureLogEvery === 0;

  if (!shouldLog) return;

  loggedFailureEvents += 1;
  const burst =
    consecutiveFailures > 1 ? ` (consecutive failures: ${consecutiveFailures})` : '';
  logger.warn(`Heartbeat ping (${reason}) failed${burst}: ${detail}`);
}

function markPingSuccess() {
  if (consecutiveFailures <= 0) return;
  const suppressed = Math.max(0, consecutiveFailures - loggedFailureEvents);
  const suppressedLabel = suppressed > 0 ? `, ${suppressed} suppressed` : '';
  logger.info(
    `Heartbeat ping recovered after ${consecutiveFailures} failure(s)${suppressedLabel}`,
  );
  consecutiveFailures = 0;
  loggedFailureEvents = 0;
}

async function sendPing(url, reason, failureLogEvery) {
  try {
    const response = await retryFetch(
      fetch,
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'DisphoriaBot-Healthcheck' },
      },
      { retries: 1, delayMs: 500, backoffFactor: 2 },
    );

    if (!response.ok) {
      markPingFailure(reason, `HTTP ${response.status}`, failureLogEvery);
      return;
    }

    markPingSuccess();
  } catch (error) {
    markPingFailure(reason, error?.message || String(error), failureLogEvery);
  }
}

function install() {
  if (installed) return;
  installed = true;

  const config = getConfig();
  if (!config.pingUrl) {
    logger.info('HEALTHCHECKS_PING_URL not set; heartbeat monitoring disabled');
    return;
  }

  logger.success(
    `Heartbeat enabled (interval ${config.intervalMs}ms) -> ${config.pingUrl}`,
  );

  if (config.pingOnStart) {
    void sendPing(config.pingUrl, 'start', config.failureLogEvery);
  }

  heartbeatTimer = setInterval(() => {
    void sendPing(config.pingUrl, 'tick', config.failureLogEvery);
  }, config.intervalMs);

  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

module.exports = { install };
