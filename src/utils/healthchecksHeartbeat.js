const logger = require('./logger')('Healthchecks');
const { retryFetch } = require('./networkRetry');

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 15_000;

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

function getConfig() {
  return {
    pingUrl: String(process.env.HEALTHCHECKS_PING_URL || '').trim(),
    intervalMs: parseInterval(process.env.HEALTHCHECKS_PING_INTERVAL_MS),
    pingOnStart: parseBool(process.env.HEALTHCHECKS_PING_ON_START, true),
  };
}

let heartbeatTimer = null;
let installed = false;

async function sendPing(url, reason) {
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
      logger.warn(`Heartbeat ping (${reason}) failed with HTTP ${response.status}`);
    }
  } catch (error) {
    logger.warn(`Heartbeat ping (${reason}) failed:`, error?.message || error);
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
    void sendPing(config.pingUrl, 'start');
  }

  heartbeatTimer = setInterval(() => {
    void sendPing(config.pingUrl, 'tick');
  }, config.intervalMs);

  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

module.exports = { install };
