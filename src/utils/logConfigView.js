const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');

const logChannelTypeStore = require('./logChannelTypeStore');
const { applyDefaultColour } = require('./guildColourStore');
const {
  listCategories,
  listKeysForCategory,
  getLogKeyCategory,
  getLogKeyLabel,
} = require('./logEvents');
const { isMysqlConfigured } = require('./mysqlPool');

const DEFAULT_COLOR = 0x5865f2;
const PAGE_SIZE = 25;

function getEntry(entries, key) {
  return entries?.[key] || { channelId: null, enabled: true };
}

function formatEntry(entry) {
  const status = entry.enabled ? 'Enabled ✅' : 'Disabled ❌';
  const channelDisplay = entry.channelId ? `<#${entry.channelId}>` : '*No channel configured*';
  return `${status}\nChannel: ${channelDisplay}`;
}

function clampPage(page, totalPages) {
  const raw = Number(page);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (totalPages <= 0) return 0;
  return Math.min(raw, totalPages - 1);
}

async function buildLogConfigView(guild, selectedKey, options = {}) {
  const guildId = guild?.id;
  const categories = listCategories();

  const fallbackCategory = categories[0] || 'Other';
  const activeCategory = categories.includes(options.category) ? options.category : (
    selectedKey ? getLogKeyCategory(selectedKey) : fallbackCategory
  );

  const keysInCategory = listKeysForCategory(activeCategory);
  const selected = (selectedKey && keysInCategory.includes(selectedKey)) ? selectedKey : (keysInCategory[0] || null);

  const totalPages = Math.max(1, Math.ceil(keysInCategory.length / PAGE_SIZE));
  const selectedIndex = selected ? keysInCategory.indexOf(selected) : 0;
  const derivedPage = selected ? Math.floor(Math.max(0, selectedIndex) / PAGE_SIZE) : 0;
  const page = clampPage(typeof options.page !== 'undefined' ? options.page : derivedPage, totalPages);
  const pageKeys = keysInCategory.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const entries = guildId ? await logChannelTypeStore.getAll(guildId) : {};
  const selectedEntry = selected ? getEntry(entries, selected) : null;

  const descriptionParts = [
    'Pick a log event, toggle it, and assign an existing channel. Changes apply immediately.',
    'No channels are created automatically; choose a channel for each event.',
    `Storage: **${isMysqlConfigured() ? 'MySQL' : 'Local JSON'}**`,
  ];
  if (options.note) descriptionParts.push(options.note);

  const embed = new EmbedBuilder()
    .setTitle('Log configuration')
    .setDescription(descriptionParts.join('\n'))
    .setColor(DEFAULT_COLOR)
    .setTimestamp(new Date());

  if (pageKeys.length) {
    embed.addFields(
      pageKeys.map(key => ({
        name: `${getLogKeyLabel(key)}${key === selected ? ' (selected)' : ''}`,
        value: formatEntry(getEntry(entries, key)),
        inline: true,
      }))
    );
  } else {
    embed.addFields({ name: 'No events in this category', value: 'Add at least one log key to configure.' });
  }

  if (selected && selectedEntry) {
    embed.addFields({
      name: `Selected: ${getLogKeyLabel(selected)}`,
      value: formatEntry(selectedEntry),
      inline: false,
    });
  }

  try {
    applyDefaultColour(embed, guildId);
  } catch (_) {}

  const categorySelectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logconfig:category')
      .setPlaceholder('Filter by category')
      .addOptions(categories.slice(0, 25).map(category => ({
        label: category,
        value: category,
        default: category === activeCategory,
      })))
  );

  const eventSelectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`logconfig:event:${activeCategory}:${page}`)
      .setPlaceholder('Select a log event to configure')
      .addOptions(pageKeys.slice(0, 25).map(key => ({
        label: getLogKeyLabel(key).slice(0, 100),
        value: key,
        default: key === selected,
      })))
      .setDisabled(!pageKeys.length)
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`logconfig:page:${activeCategory}:${page - 1}:${selected || 'none'}`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`logconfig:page:${activeCategory}:${page + 1}:${selected || 'none'}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );

  const toggleButton = new ButtonBuilder()
    .setCustomId(`logconfig:toggle:${selected ?? 'none'}`)
    .setLabel(selected ? (selectedEntry?.enabled ? 'Disable' : 'Enable') : 'Select an event')
    .setStyle(selectedEntry?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    .setDisabled(!selected);

  const buttonRow = new ActionRowBuilder().addComponents(toggleButton);

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`logconfig:setchannel:${selected ?? 'none'}`)
    .setPlaceholder(selected ? `Choose channel for ${getLogKeyLabel(selected)}` : 'Select an event first')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!selected);

  const channelRow = new ActionRowBuilder().addComponents(channelSelect);

  const components = totalPages > 1
    ? [categorySelectRow, eventSelectRow, navRow, buttonRow, channelRow]
    : [categorySelectRow, eventSelectRow, buttonRow, channelRow];

  return {
    embed,
    components,
    selectedKey: selected,
    category: activeCategory,
    page,
  };
}

module.exports = { buildLogConfigView };
