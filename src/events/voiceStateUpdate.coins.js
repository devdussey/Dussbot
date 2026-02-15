const { Events, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const coinStore = require('../utils/coinStore');
const rupeeStore = require('../utils/rupeeStore');
const smiteConfigStore = require('../utils/smiteConfigStore');
const logSender = require('../utils/logSender');
const { buildRupeeEventEmbed } = require('../utils/rupeeLogEmbed');
const {
  getVoiceCoinRewardPerMinute,
  MS_PER_MINUTE,
} = require('../utils/economyConfig');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const { formatCurrencyAmount, formatCurrencyWord } = require('../utils/currencyName');

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

async function sendRupeeAnnouncement(newState, userId, awarded, newBalance) {
  const guild = newState?.guild;
  if (!guild) return;

  const config = smiteConfigStore.getConfig(guild.id);
  const configuredChannelId = config.announceChannelId;
  let announceChannel = null;

  if (configuredChannelId) {
    announceChannel = guild.channels?.cache?.get(String(configuredChannelId)) || null;
    if (!announceChannel) {
      try {
        announceChannel = await guild.channels.fetch(String(configuredChannelId));
      } catch (_) {
        announceChannel = null;
      }
    }
  }

  if (!announceChannel) announceChannel = guild.systemChannel;
  if (!announceChannel || !announceChannel.isTextBased?.()) return;
  if (announceChannel.type === ChannelType.GuildForum) return;

  const me = guild.members?.me;
  const perms = announceChannel.permissionsFor?.(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) return;

  const amountText = awarded === 1
    ? `a ${formatCurrencyWord(guild.id, 1, { lowercase: true })}`
    : formatCurrencyAmount(guild.id, awarded, { lowercase: true });
  const announcement = `<@${userId}> earned ${amountText} from voice activity and now has ${formatCurrencyAmount(guild.id, newBalance, { lowercase: true })}!`;

  if (perms.has(PermissionFlagsBits.EmbedLinks)) {
    const embed = new EmbedBuilder()
      .setColor(resolveEmbedColour(guild.id, VOICE_RUPEE_EMBED_COLOR))
      .setDescription(`${announcement}\n\nTo spend your ${formatCurrencyWord(guild.id, 2, { lowercase: true })}, type /rupeestore.`);
    await announceChannel.send({ embeds: [embed] });
    return;
  }

  await announceChannel.send({ content: announcement });
}

async function awardRupees(newState, guildId, userId, session, deltaMs) {
  if (!guildId || !userId || !session) return;
  const config = smiteConfigStore.getConfig(guildId);
  if (!config.enabled) {
    session.rupeeRemainderMs = 0;
    return;
  }

  const voiceMinutesPerRupee = Number(config.voiceMinutesPerRupee) || 15;
  const rupeeIntervalMs = voiceMinutesPerRupee * MS_PER_MINUTE;
  session.rupeeRemainderMs = (session.rupeeRemainderMs || 0) + deltaMs;
  const awarded = Math.floor(session.rupeeRemainderMs / rupeeIntervalMs);
  if (awarded <= 0) return;

  session.rupeeRemainderMs -= awarded * rupeeIntervalMs;
  const newBalance = await rupeeStore.addTokens(guildId, userId, awarded);
  try {
    const actor = newState?.member?.user || null;
    const embed = buildRupeeEventEmbed({
      guildId,
      eventType: 'earned',
      actor,
      target: actor,
      amount: awarded,
      balance: newBalance,
      method: `Voice Activity (${voiceMinutesPerRupee} minute${voiceMinutesPerRupee === 1 ? '' : 's'})`,
    });
    await logSender.sendLog({
      guildId,
      logType: 'rupee_earned',
      embed,
      client: newState?.client,
    });
  } catch (err) {
    console.error('Failed to send voice economy earn log:', err);
  }

  try {
    await sendRupeeAnnouncement(newState, userId, awarded, newBalance);
  } catch (_) {}
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
        session = { inVoice: false, lastTimestamp: 0, coinRemainderMs: 0, rupeeRemainderMs: 0 };
        sessions.set(key, session);
      }

      const now = Date.now();
      const wasInVoice = Boolean(oldState?.channelId);
      const isInVoice = Boolean(newState?.channelId);

      if (session.inVoice && wasInVoice) {
        const delta = now - (session.lastTimestamp || now);
        if (delta > 0) {
          await awardCoins(guildId, userId, session, delta);
          await awardRupees(newState, guildId, userId, session, delta);
        }
        session.lastTimestamp = now;
      }

      if (!session.inVoice && isInVoice) {
        session.inVoice = true;
        session.lastTimestamp = now;
        session.coinRemainderMs = session.coinRemainderMs || 0;
        session.rupeeRemainderMs = session.rupeeRemainderMs || 0;
        return;
      }

      if (session.inVoice && !isInVoice) {
        const delta = now - (session.lastTimestamp || now);
        if (delta > 0) {
          await awardCoins(guildId, userId, session, delta);
          await awardRupees(newState, guildId, userId, session, delta);
        }
        session.inVoice = false;
        session.lastTimestamp = now;
        session.coinRemainderMs = 0;
        session.rupeeRemainderMs = 0;
        sessions.delete(key);
      }
    } catch (err) {
      console.error('Failed to award voice coins', err);
    }
  },
};
