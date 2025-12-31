const { ChannelType } = require('discord.js');
const { getLogKeyLabel, isValidLogKey } = require('./logEvents');

const LOG_CATEGORY_NAME = 'Logs';
function isValidLogType(logType) {
  return isValidLogKey(logType);
}

function getFriendlyName(logType) {
  return getLogKeyLabel(logType);
}

async function ensureLogCategory(guild) {
  if (!guild) return null;
  const existing = guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === LOG_CATEGORY_NAME.toLowerCase()
  );
  return existing || null;
}

async function ensureDefaultChannelForType(guild, logType) {
  if (!guild || !isValidLogType(logType)) return null;
  const safeName = String(logType).toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const channelName = `logs-${safeName}`.slice(0, 96);
  const friendly = getFriendlyName(logType);

  const existing = guild.channels.cache.find(ch =>
    ch.name === channelName && ch.type === ChannelType.GuildText
  );
  if (existing) return existing;

  console.warn(`No existing channel named ${channelName} for ${friendly} logs; automatic creation is disabled.`);
  return null;
}

module.exports = {
  LOG_CATEGORY_NAME,
  ensureLogCategory,
  ensureDefaultChannelForType,
  getFriendlyName,
};
