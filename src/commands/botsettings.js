const { SlashCommandBuilder } = require('discord.js');
const { shouldReplyEphemeral } = require('../utils/botConfigStore');
const { buildBotSettingsView } = require('../utils/botSettingsView');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botsettings')
    .setDescription('View the bot settings and defaults for this server'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const storedColour = guildId ? getStoredColour(guildId) : null;
    const effectiveColour = getDefaultColour(guildId);
    const cfg = getGuildConfig(guildId);

    const openAiConfigured = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_API);
    const chatModel = process.env.CHAT_MODEL || 'gpt-4o-mini';
    const analysisModel = process.env.ANALYSIS_MODEL || process.env.CHAT_MODEL || 'gpt-4o-mini';
    const summarizeModel = process.env.OPENAI_SUMMARIZE_MODEL || process.env.CHAT_MODEL || 'gpt-4o-mini';
    const transcribeModel = process.env.TRANSCRIBE_MODEL || 'whisper-1';
    const analysisPersonaCustom = !!(process.env.ANALYSIS_PERSONA_PROMPT && process.env.ANALYSIS_PERSONA_PROMPT.trim());

    const embedColourLines = [
      `Current: ${toHex6(effectiveColour)}`,
      storedColour == null
        ? `Source: bot default (${toHex6(DEFAULT_EMBED_COLOUR)}), no server override set.`
        : 'Change the colour via the select menu below the embed or using /colour set.',
    ];

    const aiLines = [
      `OpenAI key: ${openAiConfigured ? 'configured' : 'not set'}`,
      `Chat model: ${chatModel}`,
      `Analysis model: ${analysisModel}`,
      `Summarize model: ${summarizeModel}`,
      `Transcribe model: ${transcribeModel}`,
    ];
    if (analysisPersonaCustom) {
      aiLines.push('Analysis persona: custom prompt set');
    }

    const categoryLines = listCategories().map(def => {
      const state = cfg.categories?.[def.key];
      const enabled = isCategoryEnabled(guildId, def.key, true);
      const repliesPublic = areRepliesPublic(guildId, def.key, false);
      return `${def.label}: ${enabled ? 'Enabled ✅' : 'Disabled ⛔'} | Replies: ${repliesPublic ? 'Public 📢' : 'Private 🙈'}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Bot Settings')
      .setDescription(interaction.inGuild() ? `Current settings for **${interaction.guild.name}**.` : 'Current bot settings.')
      .addFields(
        { name: 'Embed Colour', value: embedColourLines.join('\n'), inline: false },
        { name: 'Categories', value: categoryLines.join('\n') || 'No categories configured.', inline: false },
        { name: 'AI Settings', value: aiLines.join('\n'), inline: false },
      )
      .setColor(resolveEmbedColour(guildId, DEFAULT_EMBED_COLOUR))
      .setTimestamp(new Date());

    const ephemeral = shouldReplyEphemeral(guildId, 'utility', true);
    return interaction.reply({ embeds: [embed], ephemeral });
  },
};
