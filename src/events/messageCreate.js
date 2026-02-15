const { Events } = require('discord.js');
const store = require('../utils/autoRespondStore');

const responseCooldowns = new Map();
const GIF_RESPONSE_COOLDOWN_MS = 7000;

function isGifLikeUrl(url) {
  const value = String(url || '').trim().toLowerCase();
  if (!value) return false;
  return /\.gif($|[?#])/.test(value) || value.includes('tenor.com') || value.includes('giphy.com') || value.includes('media.discordapp.net');
}

function canSendGifResponse(guildId, channelId, ruleId) {
  const key = `${guildId}:${channelId}:${ruleId}`;
  const now = Date.now();
  const last = responseCooldowns.get(key) || 0;
  if (now - last < GIF_RESPONSE_COOLDOWN_MS) return false;
  responseCooldowns.set(key, now);
  return true;
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (!message.guild) return; // guild only
      if (message.author?.bot) return; // ignore bots
      const cfg = store.getGuildConfig(message.guild.id);
      if (!cfg.enabled) return;
      const contentRaw = message.content || '';
      if (!contentRaw) return;

      for (const rule of cfg.rules) {
        if (rule.channelId && rule.channelId !== message.channel.id) continue;
        const matchType = (rule.match || 'contains');
        const hay = rule.caseSensitive ? contentRaw : contentRaw.toLowerCase();
        const needle = rule.caseSensitive ? (rule.trigger || '') : String(rule.trigger || '').toLowerCase();
        let matched = false;
        if (!needle && matchType !== 'regex') continue;
        try {
          switch (matchType) {
            case 'equals':
              matched = hay === needle; break;
            case 'starts_with':
              matched = hay.startsWith(needle); break;
            case 'regex': {
              const re = new RegExp(rule.trigger || '', rule.caseSensitive ? '' : 'i');
              matched = re.test(contentRaw);
              break;
            }
            case 'contains':
            default:
              matched = hay.includes(needle);
          }
        } catch (_) { matched = false; }

        if (matched) {
          const content = String(rule.reply || '').slice(0, 2000).trim();
          const mediaUrl = String(rule.mediaUrl || '').trim();
          const stickerId = String(rule.stickerId || '').trim();
          if (!content && !mediaUrl && !stickerId) continue;

          if (mediaUrl && isGifLikeUrl(mediaUrl) && !canSendGifResponse(message.guild.id, message.channel.id, rule.id)) {
            continue;
          }

          const payload = {
            ...(content ? { content } : {}),
            ...(mediaUrl ? { files: [mediaUrl] } : {}),
            ...(stickerId ? { stickers: [stickerId] } : {}),
          };
          try {
            await message.reply(payload);
          } catch (_) {
            // If the sticker is invalid/deleted, still send text/media when possible.
            if (!stickerId) continue;
            const fallbackPayload = {
              ...(content ? { content } : {}),
              ...(mediaUrl ? { files: [mediaUrl] } : {}),
            };
            if (fallbackPayload.content || fallbackPayload.files) {
              try { await message.reply(fallbackPayload); } catch (_) {}
            }
          }
          // do not break; allow multiple rules to respond if applicable
        }
      }
    } catch (_) { /* swallow */ }
  }
};
