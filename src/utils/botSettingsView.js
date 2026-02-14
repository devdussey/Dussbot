const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
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

const BOTSETTINGS_ACTION_SELECT_ID = 'botsettings:action';
const BOTSETTINGS_COLOUR_MODAL_ID = 'botsettings:colour';
const BOTSETTINGS_COLOUR_INPUT_ID = 'botsettings:colour_input';

const BOTSETTINGS_ACTION_CHANGE_EMBED_COLOUR = 'change_embed_colour';
const BOTSETTINGS_ACTION_REFRESH = 'refresh';

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

  const embedColourLines = [
    `Current: ${toHex6(effectiveColour)}`,
    storedColour == null
      ? `Source: bot default (${toHex6(DEFAULT_EMBED_COLOUR)}), no server override set.`
      : 'Source: server override via /botsettings.',
  ];

  const embed = new EmbedBuilder()
    .setTitle('Bot Settings')
    .setDescription(guild ? `Current settings for **${guild.name}**.` : 'Current bot settings.')
    .addFields(
      { name: 'Embed Colour', value: embedColourLines.join('\n'), inline: false },
      { name: 'API Keys', value: buildApiKeyLines().join('\n'), inline: false },
    )
    .setColor(resolveEmbedColour(guildId, DEFAULT_EMBED_COLOUR))
    .setTimestamp(new Date());

  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId(BOTSETTINGS_ACTION_SELECT_ID)
    .setPlaceholder('Choose an action')
    .addOptions(
      {
        label: 'Change Embed Colour',
        description: 'Set a server-specific default embed colour.',
        value: BOTSETTINGS_ACTION_CHANGE_EMBED_COLOUR,
      },
      {
        label: 'Refresh',
        description: 'Refresh this settings view.',
        value: BOTSETTINGS_ACTION_REFRESH,
      },
    );

  return {
    embed,
    components: [new ActionRowBuilder().addComponents(actionSelect)],
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
  BOTSETTINGS_ACTION_SELECT_ID,
  BOTSETTINGS_COLOUR_MODAL_ID,
  BOTSETTINGS_COLOUR_INPUT_ID,
  BOTSETTINGS_ACTION_CHANGE_EMBED_COLOUR,
  BOTSETTINGS_ACTION_REFRESH,
  buildBotSettingsView,
  buildEmbedColourModal,
};
