const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { applyDefaultColour } = require('./guildColourStore');
const {
  listCategories,
  getGuildConfig,
  toggleCategoryEnabled,
  toggleCategoryPublicReplies,
  resetGuildConfig,
} = require('./botConfigStore');

function statusEmoji(enabled) {
  return enabled ? '✅' : '⛔';
}

function replyEmoji(publicReplies) {
  return publicReplies ? '📢 Public' : '🙈 Private';
}

function buildSummaryField(cfg) {
  const lines = [];
  for (const def of listCategories()) {
    const state = cfg.categories?.[def.key];
    const enabled = state?.enabled !== false;
    const publicReplies = state?.publicReplies === true;
    lines.push(`**${def.label}** — ${statusEmoji(enabled)} | ${replyEmoji(publicReplies)}`);
  }
  return lines.join('\n') || 'No categories defined.';
}

async function buildBotConfigView(guild, selectedCategory) {
  const guildId = guild?.id;
  const cfg = getGuildConfig(guildId);
  const categories = listCategories();
  const selected = categories.find(c => c.key === selectedCategory)?.key || categories[0]?.key || null;
  const selectedDef = categories.find(c => c.key === selected) || categories[0] || null;
  const selectedState = selectedDef ? cfg.categories?.[selectedDef.key] : null;

  const embed = new EmbedBuilder()
    .setTitle('Bot Configuration')
    .setDescription('Toggle feature availability and reply visibility per category. Changes apply immediately.')
    .addFields(
      { name: 'All Categories', value: buildSummaryField(cfg), inline: false },
    )
    .setTimestamp(new Date());

  if (selectedDef) {
    const enabled = selectedState?.enabled !== false;
    const publicReplies = selectedState?.publicReplies === true;
    embed.addFields({
      name: `Selected: ${selectedDef.label}`,
      value: [
        selectedDef.description,
        `Status: ${enabled ? 'Enabled ✅' : 'Disabled ⛔'}`,
        `Replies: ${publicReplies ? 'Public 📢' : 'Private 🙈'}`,
      ].join('\n'),
      inline: false,
    });
  }

  try { applyDefaultColour(embed, guildId); } catch (_) {}

  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId('botconfig:category')
    .setPlaceholder('Choose a category')
    .addOptions(categories.map(def => ({
      label: `${def.label} (${statusEmoji(cfg.categories?.[def.key]?.enabled !== false)})`,
      description: def.description.slice(0, 95),
      value: def.key,
      default: def.key === selected,
    })).slice(0, 25));

  const toggleEnabledButton = new ButtonBuilder()
    .setCustomId(`botconfig:toggleEnabled:${selected || 'none'}`)
    .setLabel(selectedState?.enabled === false ? 'Enable' : 'Disable')
    .setStyle(selectedState?.enabled === false ? ButtonStyle.Success : ButtonStyle.Danger)
    .setDisabled(!selected);

  const toggleRepliesButton = new ButtonBuilder()
    .setCustomId(`botconfig:toggleReplies:${selected || 'none'}`)
    .setLabel(selectedState?.publicReplies ? 'Set Private' : 'Set Public')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!selected);

  const resetButton = new ButtonBuilder()
    .setCustomId(`botconfig:reset:${selected || 'none'}`)
    .setLabel('Reset to defaults')
    .setStyle(ButtonStyle.Secondary);

  return {
    embed,
    components: [
      new ActionRowBuilder().addComponents(categorySelect),
      new ActionRowBuilder().addComponents(toggleEnabledButton, toggleRepliesButton, resetButton),
    ],
    selectedCategory: selected,
  };
}

async function handleToggleEnabled(interaction, categoryKey) {
  const updated = toggleCategoryEnabled(interaction.guildId, categoryKey);
  if (!updated) throw new Error('Invalid category.');
  return buildBotConfigView(interaction.guild, categoryKey);
}

async function handleToggleReplies(interaction, categoryKey) {
  const updated = toggleCategoryPublicReplies(interaction.guildId, categoryKey);
  if (!updated) throw new Error('Invalid category.');
  return buildBotConfigView(interaction.guild, categoryKey);
}

async function handleReset(interaction, categoryKey) {
  resetGuildConfig(interaction.guildId);
  return buildBotConfigView(interaction.guild, categoryKey);
}

module.exports = {
  buildBotConfigView,
  handleToggleEnabled,
  handleToggleReplies,
  handleReset,
};
