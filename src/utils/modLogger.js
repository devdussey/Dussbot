const store = require('./modLogStore');
const { resolveEmbedColour } = require('./guildColourStore');
const logSender = require('./logSender');
const { buildLogEmbed } = require('./logEmbedFactory');

async function send(interaction, embed, logKey = 'moderation') {
  const guild = interaction.guild;
  const client = interaction.client;
  if (!guild) return false;
  if ((await store.getEnabled(guild.id)) === false) return false;

  const ownerFallbackOnChannelFail = String(process.env.OWNER_FALLBACK_ON_CHANNEL_FAIL || '').toLowerCase() === 'true';

  // Try new unified log sender first (uses logChannelTypeStore)
  const sent = await logSender.sendLog({
    guildId: guild.id,
    logType: logKey || 'moderation',
    embed,
    client,
    ownerFallback: ownerFallbackOnChannelFail,
  });

  if (sent) return true;

  // Fallback to old system if new system didn't send
  const mode = (await store.getMode(guild.id)) || 'channel';
  const channelId = (await store.get(guild.id)) || process.env.MOD_LOG_CHANNEL_ID;

  const tryChannel = async () => {
    if (!channelId) return false;
    const ch = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(err => {
      console.error(`Failed to fetch mod log channel ${channelId} in guild ${guild.id}`, err);
      return null;
    });
    if (!ch) {
      console.error(`Mod log channel ${channelId} not found or inaccessible in guild ${guild.id}`);
      return false;
    }
    if (ch.isTextBased?.()) {
      try {
        await ch.send({ embeds: [embed] });
        return true;
      } catch (err) {
        console.error(`Failed to send mod log message to channel ${channelId} in guild ${guild.id}`, err);
      }
    }
    return false;
  };

  if (mode === 'channel') {
    return await tryChannel();
  }

  return false;
}

async function sendPublicReply(interaction, embed) {
  const channel = interaction?.channel;
  if (!channel || !channel.isTextBased?.()) return false;
  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error(`Failed to send public moderation reply in channel ${channel?.id || 'unknown'}`, err);
    return false;
  }
}

function buildMarkerFields(interaction) {
  const fields = [];
  if (interaction.guild) {
    fields.push({ name: 'Guild', value: `${interaction.guild.name} (${interaction.guild.id})`, inline: false });
  }
  if (interaction.channel) {
    fields.push({ name: 'Channel', value: `<#${interaction.channel.id}> (${interaction.channel.id})`, inline: false });
  }
  return fields;
}

async function log(interaction, title, options = {}) {
  const { reason, target, extraFields = [], color, logKey } = options;
  const resolvedColor = resolveEmbedColour(interaction.guildId, color ?? 0x5865f2);
  const equipFields = [...buildMarkerFields(interaction), ...(Array.isArray(extraFields) ? extraFields : [])];
  const embed = buildLogEmbed({
    action: title,
    target: target || interaction.user,
    actor: interaction.user,
    reason: reason || 'No reason provided',
    color: resolvedColor,
    extraFields: equipFields,
  });
  await send(interaction, embed, logKey || 'moderation');
  await sendPublicReply(interaction, embed);
}

module.exports = { log };
