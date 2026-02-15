const smiteConfigStore = require('./smiteConfigStore');

function safeAmount(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  return Math.floor(num);
}

function getCurrencyName(guildId) {
  return smiteConfigStore.getCurrencyName(guildId) || smiteConfigStore.DEFAULT_CURRENCY_NAME;
}

function getCurrencyPlural(name) {
  const safe = String(name || smiteConfigStore.DEFAULT_CURRENCY_NAME).trim() || smiteConfigStore.DEFAULT_CURRENCY_NAME;
  if (/s$/i.test(safe)) return safe;
  return `${safe}s`;
}

function formatCurrencyAmount(guildId, amount, { lowercase = false } = {}) {
  const singular = getCurrencyName(guildId);
  const plural = getCurrencyPlural(singular);
  const value = safeAmount(amount);
  const word = value === 1 ? singular : plural;
  if (!lowercase) return `${value} ${word}`;
  return `${value} ${word.toLowerCase()}`;
}

function formatCurrencyWord(guildId, amount = 1, { lowercase = false } = {}) {
  const singular = getCurrencyName(guildId);
  const plural = getCurrencyPlural(singular);
  const word = safeAmount(amount) === 1 ? singular : plural;
  return lowercase ? word.toLowerCase() : word;
}

module.exports = {
  getCurrencyName,
  getCurrencyPlural,
  formatCurrencyAmount,
  formatCurrencyWord,
};
