// Unified log sender that routes logs to appropriate channels based on type
const logChannelTypeStore = require('./logChannelTypeStore');
const { parseOwnerIds } = require('./ownerIds');

/**
 * Send a log message to the appropriate channel(s)
 * @param {Object} options - Log options
 * @param {string} options.guildId - Guild ID
 * @param {string} options.logType - Log type (moderation, security, message, member, role, channel, server, verification, invite)
 * @param {Object} options.embed - Discord embed or array of embeds to send
 * @param {Object} options.client - Discord client (for owner DM fallback)
 * @param {boolean} options.ownerFallback - Whether to DM owners if channel fails (default: false)
 * @returns {Promise<boolean>} - True if successfully sent to at least one destination
 */
async function sendLog(options) {
  const {
    guildId,
    logType,
    embed,
    client,
    ownerFallback = false,
  } = options;

  if (!guildId || !logType || !embed) {
    console.error('logSender: Missing required options', { guildId, logType, embed: !!embed });
    return false;
  }

  let sentSuccessfully = false;

  // Try to send to the configured channel for this log type
  try {
    const channelId = await logChannelTypeStore.getChannel(guildId, logType);
    if (channelId && client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const channel = guild.channels.cache.get(channelId) ||
          await guild.channels.fetch(channelId).catch(() => null);

        if (channel && channel.isTextBased?.()) {
          try {
            const embeds = Array.isArray(embed) ? embed : [embed];
            await channel.send({ embeds });
            sentSuccessfully = true;
          } catch (err) {
            console.error(`Failed to send ${logType} log to channel ${channelId}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error(`Error checking log channel for type ${logType}:`, err.message);
  }

  // Fallback to owner DMs if configured and channel send failed
  if (!sentSuccessfully && ownerFallback && client) {
    try {
      const owners = parseOwnerIds();
      for (const ownerId of owners) {
        try {
          const user = await client.users.fetch(ownerId);
          const embeds = Array.isArray(embed) ? embed : [embed];
          await user.send({
            content: `[${logType.toUpperCase()} LOG - Guild: ${guildId}]`,
            embeds,
          });
          sentSuccessfully = true;
        } catch (err) {
          console.error(`Failed to notify owner ${ownerId}:`, err.message);
        }
      }
    } catch (err) {
      console.error('Error sending owner fallback:', err.message);
    }
  }

  return sentSuccessfully;
}

/**
 * Send multiple logs at once (batch logging)
 * @param {Object} options - Same as sendLog but logType is replaced with logs array
 * @param {Array} options.logs - Array of {logType, embed} objects
 * @returns {Promise<Object>} - {successful: number, failed: number}
 */
async function sendLogs(options) {
  const {
    guildId,
    logs,
    client,
    ownerFallback = false,
  } = options;

  let successful = 0;
  let failed = 0;

  for (const { logType, embed } of logs) {
    const result = await sendLog({
      guildId,
      logType,
      embed,
      client,
      ownerFallback,
    });
    if (result) successful++;
    else failed++;
  }

  return { successful, failed };
}

module.exports = {
  sendLog,
  sendLogs,
};
