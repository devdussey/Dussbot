const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const coinStore = require('../utils/coinStore');
const rupeeStore = require('../utils/rupeeStore');
const smiteConfigStore = require('../utils/smiteConfigStore');
const {
  getVoiceCoinRewardPerMinute,
  MS_PER_MINUTE,
} = require('../utils/economyConfig');
const { resolveEmbedColour } = require('../utils/guildColourStore');

const RUPEE_VOICE_INTERVAL_MS = 15 * MS_PER_MINUTE;
const VOICE_RUPEE_EMBED_COLOR = 0x00f0ff;
const sessions = new Map();

function getKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function awardCoins(guildId, userId, session, deltaMs) {
  if (!guildId || !userId || !session) return;
  session.coinRemainderMs = (session.coinRemainderMs || 0) + deltaMs;
  const rewardPerMinute = getVoiceCoinRewardPerMinute();
  if (rewardPerMinute <= 0) {
    session.coinRemainderMs = 0;
    return;
  }
  const fullMinutes = Math.floor(session.coinRemainderMs / MS_PER_MINUTE);
  if (fullMinutes <= 0) return;
  session.coinRemainderMs -= fullMinutes * MS_PER_MINUTE;
  const coins = fullMinutes * rewardPerMinute;
  await coinStore.addCoins(guildId, userId, coins);
}

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    try {
      const guildId = newState?.guild?.id || oldState?.guild?.id;
      const userId = newState?.id || oldState?.id;
      if (!guildId || !userId) return;

      const key = getKey(guildId, userId);
      let session = sessions.get(key);
      if (!session) {
        session = { inVoice: false, lastTimestamp: 0, remainderMs: 0 };
        sessions.set(key, session);
      }

      const now = Date.now();
      const wasInVoice = Boolean(oldState?.channelId);
      const isInVoice = Boolean(newState?.channelId);

      if (session.inVoice && wasInVoice) {
        const delta = now - (session.lastTimestamp || now);
        if (delta > 0) {
          await awardCoins(guildId, userId, session, delta);
        }
        session.lastTimestamp = now;
      }

      if (!session.inVoice && isInVoice) {
        session.inVoice = true;
        session.lastTimestamp = now;
        session.coinRemainderMs = session.coinRemainderMs || 0;
        return;
      }

      if (session.inVoice && !isInVoice) {
        const delta = now - (session.lastTimestamp || now);
        if (delta > 0) {
          await awardCoins(guildId, userId, session, delta);
        }
        session.inVoice = false;
        session.lastTimestamp = now;
        session.coinRemainderMs = 0;
        sessions.delete(key);
      }
    } catch (err) {
      console.error('Failed to award voice coins', err);
    }
  },
};
