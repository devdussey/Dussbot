const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  getStoredColour,
  getDefaultColour,
  toHex6,
  DEFAULT_EMBED_COLOUR,
  resolveEmbedColour,
} = require('./guildColourStore');
const premiumManager = require('./premiumManager');

const BOTSETTINGS_ACTION_CHANGE_EMBED_COLOUR_ID = 'botsettings:change_embed_colour';
const BOTSETTINGS_ACTION_REFRESH_ID = 'botsettings:refresh';
const BOTSETTINGS_COLOUR_MODAL_ID = 'botsettings:colour';
const BOTSETTINGS_COLOUR_INPUT_ID = 'botsettings:colour_input';

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatConfigured(value) {
  return value ? 'configured ✅' : 'not set ⛔';
}

function buildApiKeyLines() {
  const openAiConfigured = hasValue(process.env.OPENAI_API_KEY) || hasValue(process.env.OPENAI_API);
  const automodOpenAiConfigured = hasValue(process.env.AUTOMOD_OPENAI_API_KEY) || openAiConfigured;

  return [
    `DISCORD_TOKEN: ${formatConfigured(hasValue(process.env.DISCORD_TOKEN))}`,
    `OPENAI_API_KEY / OPENAI_API: ${formatConfigured(openAiConfigured)}`,
    `AUTOMOD_OPENAI_API_KEY: ${formatConfigured(automodOpenAiConfigured)}`,
    `REMOVE_BG_API_KEY: ${formatConfigured(hasValue(process.env.REMOVE_BG_API_KEY))}`,
  ];
}

function buildBotSettingsView(guild) {
  const guildId = guild?.id || null;
  const storedColour = guildId ? getStoredColour(guildId) : null;
  const effectiveColour = getDefaultColour(guildId);
  const premiumActive = guildId ? premiumManager.hasGuildPremium(guildId) : false;

  const embedColourLines = [
    `Current: ${toHex6(effectiveColour)}`,
    storedColour == null
      ? `Source: bot default (${toHex6(DEFAULT_EMBED_COLOUR)}), no server override set.`
      : 'Source: server override via /botsettings.',
  ];
  const premiumLines = [
    `Premium enabled for this server: ${premiumActive ? 'Yes ✅' : 'No ⛔'}`,
    'Premium members get custom bot avatar and banner, and Bot Name.',
  ];

  const embed = new EmbedBuilder()
    .setTitle('Bot Settings')
    .setDescription(guild ? `Current settings for **${guild.name}**.` : 'Current bot settings.')
    .addFields(
      { name: 'Embed Colour', value: embedColourLines.join('\n'), inline: false },
      { name: 'API Keys', value: buildApiKeyLines().join('\n'), inline: false },
      { name: 'Premium Benefits', value: premiumLines.join('\n'), inline: false },
    )
    .setColor(resolveEmbedColour(guildId, DEFAULT_EMBED_COLOUR))
    .setTimestamp(new Date());

  const changeEmbedColourButton = new ButtonBuilder()
    .setCustomId(BOTSETTINGS_ACTION_CHANGE_EMBED_COLOUR_ID)
    .setLabel('Change Embed Colour')
    .setStyle(ButtonStyle.Primary);

  const refreshButton = new ButtonBuilder()
    .setCustomId(BOTSETTINGS_ACTION_REFRESH_ID)
    .setLabel('Refresh')
    .setStyle(ButtonStyle.Secondary);

  return {
    embed,
    components: [new ActionRowBuilder().addComponents(changeEmbedColourButton, refreshButton)],
  };
}

function buildEmbedColourModal(guildId) {
  const currentColour = toHex6(getDefaultColour(guildId));
  const input = new TextInputBuilder()
    .setCustomId(BOTSETTINGS_COLOUR_INPUT_ID)
    .setLabel('Embed colour')
    .setPlaceholder('#RRGGBB, #RGB, 0xRRGGBB, or reset')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(16)
    .setValue(currentColour);

  const row = new ActionRowBuilder().addComponents(input);
  return new ModalBuilder()
    .setCustomId(BOTSETTINGS_COLOUR_MODAL_ID)
    .setTitle('Change Embed Colour')
    .addComponents(row);
}

module.exports = {
  BOTSETTINGS_ACTION_CHANGE_EMBED_COLOUR_ID,
  BOTSETTINGS_ACTION_REFRESH_ID,
  BOTSETTINGS_COLOUR_MODAL_ID,
  BOTSETTINGS_COLOUR_INPUT_ID,
  buildBotSettingsView,
  buildEmbedColourModal,
};
