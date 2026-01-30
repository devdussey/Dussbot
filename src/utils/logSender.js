// Unified log sender that routes logs to appropriate channels based on key
const { PermissionsBitField, ChannelType } = require('discord.js');
const logChannelTypeStore = require('./logChannelTypeStore');
const { getFallbackKey } = require('./logEvents');
const { parseOwnerIds } = require('./ownerIds');

const forumThreadCache = new Map();
const DEFAULT_FORUM_ARCHIVE_MINUTES = 1440;
const UNKNOWN_CHANNEL_CODES = new Set([10003]);

function permName(flag) {
  return Object.entries(PermissionsBitField.Flags).find(([, value]) => value === flag)?.[0] || String(flag);
}

function requiredPermissionsForChannel(channel) {
  const base = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.EmbedLinks,
  ];
  if (!channel) return base;

  if (typeof channel.isThread === 'function' ? channel.isThread() : Boolean(channel.isThread)) {
    return [...base, PermissionsBitField.Flags.SendMessagesInThreads];
  }
  if (channel.type === ChannelType.GuildForum) {
    return [
      ...base,
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.SendMessagesInThreads,
    ];
  }
  return [...base, PermissionsBitField.Flags.SendMessages];
}

function buildForumThreadName(logKey) {
  const raw = String(logKey || 'logs').replace(/_/g, ' ').trim() || 'logs';
  const base = raw.length > 90 ? raw.slice(0, 90) : raw;
  const suffixNeeded = !/\blogs?$/i.test(base);
  const name = suffixNeeded ? `${base} logs` : base;
  return name.slice(0, 100);
}

function resolveForumArchiveDuration(channel) {
  const allowed = new Set([60, 1440, 4320, 10080]);
  const preferred = channel?.defaultAutoArchiveDuration;
  return allowed.has(preferred) ? preferred : DEFAULT_FORUM_ARCHIVE_MINUTES;
}

function isUnknownChannelError(err) {
  if (!err) return false;
  const code = err?.code || err?.status;
  return code === 404 || UNKNOWN_CHANNEL_CODES.has(code);
}

async function clearMissingChannelEntry(guildId, logKey, channelId) {
  try {
    const removed = await logChannelTypeStore.removeChannel(guildId, logKey);
    if (removed) {
      console.info(`logSender: Cleared log entry ${logKey} for guild ${guildId} after channel ${channelId} became unavailable.`);
    }
  } catch (err) {
    console.error(`logSender: Failed to clear log entry ${logKey} for guild ${guildId}:`, err?.message || err);
  }
}

async function fetchCachedForumThread(channel, cacheKey) {
  const cachedId = forumThreadCache.get(cacheKey);
  if (!cachedId) return null;
  const thread = await channel.threads.fetch(cachedId).catch(() => null);
  if (!thread || thread.archived || thread.locked) {
    forumThreadCache.delete(cacheKey);
    return null;
  }
  return thread;
}

async function findReusableForumThread(channel, threadName) {
  try {
    const active = await channel.threads.fetchActive();
    const target = threadName.toLowerCase();
    const botId = channel.client?.user?.id || null;
    for (const thread of active.threads.values()) {
      if (thread.archived || thread.locked) continue;
      if ((thread.name || '').toLowerCase() !== target) continue;
      if (botId && thread.ownerId && thread.ownerId !== botId) continue;
      return thread;
    }
  } catch (err) {
    console.error(`logSender: Failed to inspect active threads in forum ${channel.id}:`, err?.message || err);
  }
  return null;
}

async function sendToForumChannel(channel, logKey, embeds, files) {
  const cacheKey = `${channel.id}:${logKey || 'logs'}`;
  const threadName = buildForumThreadName(logKey);
  const embedsArray = Array.isArray(embeds) ? embeds : [embeds];
  const payload = files?.length ? { embeds: embedsArray, files } : { embeds: embedsArray };

  try {
    const cached = await fetchCachedForumThread(channel, cacheKey);
    let thread = cached || await findReusableForumThread(channel, threadName);

    if (thread) {
      try {
        await thread.send(payload);
        forumThreadCache.set(cacheKey, thread.id);
        return true;
      } catch (err) {
        const code = err?.code || err?.status;
        console.error(`logSender: Failed to send to forum thread ${thread.id} for ${logKey} (code ${code}):`, err?.message || err);
        forumThreadCache.delete(cacheKey);
      }
    }

    const created = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: resolveForumArchiveDuration(channel),
      reason: `Log thread for ${logKey}`,
      message: payload,
    });
    forumThreadCache.set(cacheKey, created.id);
    return true;
  } catch (err) {
    const code = err?.code || err?.status;
    console.error(`logSender: Failed to create or use forum thread in ${channel.id} for ${logKey} (code ${code}):`, err?.message || err);
    return false;
  }
}

/**
 * Send a log message to the appropriate channel(s)
 * @param {Object} options - Log options
 * @param {string} options.guildId - Guild ID
 * @param {string} options.logType - Log routing key (e.g. message_delete, member_ban, channel_update)
 * @param {Object} options.embed - Discord embed or array of embeds to send
 * @param {Object} options.client - Discord client (for owner DM fallback)
 * @param {boolean} options.ownerFallback - Whether to DM owners if channel fails (default: false)
 * @param {Array} [options.files] - Optional attachments to include with the log message
 * @returns {Promise<boolean>} - True if successfully sent to at least one destination
 */
async function sendLog(options) {
  const {
    guildId,
    logType,
    embed,
    client,
    ownerFallback = false,
    files = null,
  } = options;

  if (!guildId || !logType || !embed) {
    console.error('logSender: Missing required options', { guildId, logType, embed: !!embed });
    return false;
  }

  const embedsArray = Array.isArray(embed) ? embed : [embed];
  const filesArray = Array.isArray(files) && files.length ? files : null;
  const fallbackKey = getFallbackKey(logType);
  let sentSuccessfully = false;
  let resolvedLogKey = logType;

  // Check whether this log key is enabled before attempting to send.
  // If no channel is configured for the specific key, fall back to its group key (if defined).
  const directEntry = guildId ? await logChannelTypeStore.getEntry(guildId, logType) : null;
  if (directEntry && directEntry.enabled === false) return false;

  let channelId = directEntry?.channelId || null;
  if (!channelId && fallbackKey) {
    const fallbackEntry = await logChannelTypeStore.getEntry(guildId, fallbackKey);
    if (fallbackEntry && fallbackEntry.enabled === false) return false;
    if (fallbackEntry?.channelId) resolvedLogKey = fallbackKey;
    channelId = fallbackEntry?.channelId || null;
  }

  // Try to send to the configured channel for this log type
  try {
    if (channelId && client) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        console.error(`logSender: Guild ${guildId} not found in cache for ${logType}`);
      } else {
        let channel = guild.channels.cache.get(channelId);
        let channelFetchError = null;

        if (!channel) {
          try {
            channel = await guild.channels.fetch(channelId);
          } catch (err) {
            channelFetchError = err;
            const code = err?.code || err?.status;
            console.error(`logSender: Failed to fetch channel ${channelId} in guild ${guildId} for ${logType} (code ${code}):`, err?.message || err);
          }
        }

        if (!channel) {
          console.error(`logSender: Channel ${channelId} not found/accessible in guild ${guildId} for ${logType}`);
          if (isUnknownChannelError(channelFetchError)) {
            await clearMissingChannelEntry(guildId, resolvedLogKey, channelId);
          }
        } else if (!channel.isTextBased?.() && channel.type !== ChannelType.GuildForum) {
          console.error(`logSender: Channel ${channelId} is not text-based for ${logType}`);
        } else {
          let allowed = true;
          const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
          if (me) {
            const required = requiredPermissionsForChannel(channel);
            const perms = channel.permissionsFor(me);
            if (!perms || !perms.has(required)) {
              allowed = false;
              const missing = required
                .filter(flag => !perms?.has(flag))
                .map(permName);
              console.error(`logSender: Missing permissions in channel ${channelId} for ${logType}: ${missing.join(', ') || 'Unknown'}`);
            }
          }

          if (allowed) {
            try {
              const payload = filesArray ? { embeds: embedsArray, files: filesArray } : { embeds: embedsArray };
              if (channel.type === ChannelType.GuildForum) {
                const sent = await sendToForumChannel(channel, resolvedLogKey, embedsArray, filesArray || undefined);
                sentSuccessfully = sentSuccessfully || sent;
              } else {
                await channel.send(payload);
                sentSuccessfully = true;
              }
            } catch (err) {
              const code = err?.code || err?.status;
              console.error(`Failed to send ${logType} log to channel ${channelId} (code ${code}):`, err?.message || err);
            }
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
          const dmPayload = {
            content: `[${logType.toUpperCase()} LOG - Guild: ${guildId}]`,
            embeds: embedsArray,
          };
          if (filesArray) dmPayload.files = filesArray;
          await user.send(dmPayload);
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

  for (const { logType, embed, files } of logs) {
    const result = await sendLog({
      guildId,
      logType,
      embed,
      client,
      ownerFallback,
      files,
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
