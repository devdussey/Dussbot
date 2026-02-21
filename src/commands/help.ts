// @ts-nocheck

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { getSupportServerUrl } = require('../utils/supportServer');

const SUPPORT_SERVER_LINE = `For more detailed help and updates, join the support server ${getSupportServerUrl()}`;
const HELP_CATEGORY_ID_PREFIX = 'help-category';

/** @typedef {{ cmd: string, desc: string, perm: string | null }} HelpCommand */
/** @typedef {{ blurb?: string }} CategoryMeta */

/** @type {Record<string, HelpCommand[]>} */
const categories = {
  'Moderation': [
    { cmd: '/banlist', desc: 'List current banned users in the server.', perm: 'Ban Members' },
    { cmd: '/mute', desc: 'Timeout a member for a set duration (reason required).', perm: 'Moderate Members' },
    { cmd: '/kick', desc: 'Remove a member from the server (reason required).', perm: 'Kick Members' },
    { cmd: '/ban', desc: 'Ban a member with optional prune window (reason required).', perm: 'Ban Members' },
    { cmd: '/unban', desc: 'Lift a ban with a reason.', perm: 'Ban Members' },
    { cmd: '/unmute', desc: 'Remove a timeout with a reason.', perm: 'Moderate Members' },
  ],
  Administration: [
    { cmd: '/modconfig', desc: 'Configure the moderator role and mod action log channel.', perm: 'Manage Server' },
    { cmd: '/role create/delete/edit/clean', desc: 'Role Management.', perm: 'Administrator' },
    { cmd: '/boosterroleconfig', desc: 'Booster Role Configurations.', perm: 'Manage Server' },
    { cmd: '/channel create/edit/sync', desc: 'Channel Management.', perm: 'Administrator' },
    { cmd: '/autoroles add/remove/list/clear', desc: 'Automatic Role Assignments.', perm: 'Manage Roles' },
    { cmd: '/confessconfig', desc: 'Post the anonymous confession panel.', perm: 'Manage Server' },
    { cmd: '/suggestconfig', desc: 'Post the anonymous suggestion panel.', perm: 'Manage Server' },
    { cmd: '/sacrificeconfig', desc: 'Post the communal sacrifice panel.', perm: 'Administrator' },
    { cmd: '/autorespond toggle/add/remove/list', desc: 'Autoresponder Management.', perm: 'Administrator' },
    { cmd: '/automessage create/delete/list', desc: 'Schedule recurring server messages.', perm: 'Manage Server' },
    { cmd: '/stickymessage set/clear/view', desc: 'Configure delayed sticky messages per channel.', perm: 'Administrator' },
    { cmd: '/say', desc: 'Send a custom bot message to a selected channel.', perm: 'Administrator' },
    { cmd: '/logconfig', desc: 'Configure logging channels and toggle events.', perm: 'Administrator' },
    { cmd: '/antinuke config', desc: 'Configure anti-nuke detections and thresholds.', perm: 'Manage Server' },
    { cmd: '/transriptconfig enable/disable/status', desc: 'Manage voice transcription automation.', perm: 'Manage Server' },
    { cmd: '/purge', desc: 'Bulk delete up to 100 recent messages.', perm: 'Manage Messages' },
    { cmd: '/webhooks', desc: 'List server webhooks and creators.', perm: 'Administrator' },
    { cmd: '/emoji add/edit/delete/clone', desc: 'Manage server emojis from uploads or media URLs.', perm: 'Manage Expressions' },
    { cmd: '/sticker add/edit/delete/clone', desc: 'Manage server stickers from uploads or media URLs.', perm: 'Manage Expressions' },
    { cmd: '/donate', desc: 'Grant server currency directly to a user.', perm: 'Administrator' },
    { cmd: '/massblessing', desc: 'Give every non-bot user server currency.', perm: 'Administrator' },
    { cmd: '/embed create/quick', desc: 'Build embeds through guided tools.', perm: 'Administrator' },
    { cmd: '/botsettings', desc: 'View bot settings and change default embed colour.', perm: 'Administrator' },
    { cmd: '/economyconfig', desc: 'Configure economy rewards, currency name, store prices, immunity role, and economy channels.', perm: 'Manage Server' },
    { cmd: '/debug', desc: 'Run diagnostics or refresh command/event handlers.', perm: 'Administrator' },
  ],
  Configurations: [
    { cmd: '/modconfig', desc: 'Configure the moderator role and mod log channel.', perm: 'Manage Server' },
    { cmd: '/boosterroleconfig', desc: 'Post the booster role configuration panel.', perm: 'Manage Server' },
    { cmd: '/confessconfig', desc: 'Post the anonymous confession panel.', perm: 'Manage Server' },
    { cmd: '/suggestconfig', desc: 'Post the anonymous suggestion panel.', perm: 'Manage Server' },
    { cmd: '/sacrificeconfig', desc: 'Post the communal sacrifice panel.', perm: 'Administrator' },
    { cmd: '/autorespond toggle/add/remove/list', desc: 'Configure keyword-based automated replies.', perm: 'Administrator' },
    { cmd: '/automessage create/delete/list', desc: 'Schedule recurring server messages.', perm: 'Manage Server' },
    { cmd: '/stickymessage set/clear/view', desc: 'Configure delayed sticky messages per channel.', perm: 'Administrator' },
    { cmd: '/logconfig', desc: 'Configure logging channels and toggle events.', perm: 'Administrator' },
    { cmd: '/antinuke config', desc: 'Configure anti-nuke detections and thresholds.', perm: 'Manage Server' },
    { cmd: '/transriptconfig enable/disable/status', desc: 'Manage voice transcription automation.', perm: 'Manage Server' },
    { cmd: '/botsettings', desc: 'View bot settings and change default embed colour.', perm: 'Administrator' },
    { cmd: '/economyconfig', desc: 'Configure economy rewards, currency name, store prices, immunity role, and economy channels.', perm: 'Manage Server' },
    { cmd: '/storeconfig add/remove/post', desc: 'Enable or remove specific store items, and post enabled item panels.', perm: 'Administrator' },
    { cmd: '/wordstatsconfig set/view/reset/scan/resume', desc: 'Configure live tracking and run resumable channel scan exports for word stats.', perm: 'Manage Server' },
  ],
  'AI': [
    { cmd: '/chat', desc: 'Chat with the AI assistant.', perm: null },
    { cmd: '/analysis', desc: 'Spend 1 currency to analyze your recent messages.', perm: null },
    { cmd: '/summarize', desc: 'Summarize recent channel discussion.', perm: null },
    { cmd: '/transcribe', desc: 'Transcribe an attached audio file.', perm: null },
    { cmd: '/image removebg image/gif', desc: 'Remove image background (non-premium servers: 1 use/day).', perm: 'Premium server for unlimited' },
    { cmd: '/image enlarge emoji/sticker/media', desc: 'Upscale emojis, stickers, and media.', perm: null },
    { cmd: '/image resize', desc: 'Resize an image by percentage or fixed pixel presets.', perm: null },
    { cmd: '/imagefilter', desc: 'Apply a GIF filter edit to an uploaded image, URL, or user avatar.', perm: null },
  ],
  'Economy System and Games': [
    { cmd: '/balance leaderboard', desc: 'View the server currency leaderboard.', perm: null },
    { cmd: '/balance personal', desc: 'View your personal server currency balance.', perm: null },
    { cmd: '/balance user', desc: 'View another member\'s server currency balance.', perm: null },
    { cmd: 'Store Panels', desc: 'Spend currency using the configured store panel messages.', perm: null },
    { cmd: '/storeconfig add/remove/post', desc: 'Enable or remove specific store items, and post enabled item panels.', perm: 'Administrator' },
    { cmd: '/economyconfig', desc: 'Configure economy rewards, currency name, store prices, immunity role, and economy channels.', perm: 'Manage Server' },
    { cmd: '/blessing', desc: 'Claim your daily blessing currency.', perm: 'Administrator' },
    { cmd: '/casino horserace', desc: 'Start a horse race lobby with join/leave queue and prize payouts.', perm: null },
    { cmd: '/wordrush start', desc: 'Start a WordRush lobby.', perm: null },
    { cmd: '/casino roulette', desc: 'Start an roulette round with configurable bets.', perm: null },
  ],
  'Utilities and Bot Info': [
    { cmd: '/avatar', desc: 'Display user avatar and download links.', perm: null },
    { cmd: '/serverbanner', desc: 'Display and download server banner.', perm: null },
    { cmd: '/serverlogo', desc: 'Display and download server icon.', perm: null },
    { cmd: '/wordstats [view] [search] [word] [user]', desc: 'Word/message leaderboards and word/user searches from wordstatsconfig data.', perm: null },
    { cmd: '/botinfo', desc: 'View bot instance and uptime info.', perm: null },
    { cmd: '/premium', desc: 'Coming Soon.', perm: null },
  ],
};

/** @type {Record<string, CategoryMeta>} */
const categoryMeta = {
  'Moderation': { blurb: 'Moderation Commands and Action Logging' },
  Administration: { blurb: 'Commands to make administration tasks simple and easy. Also includes bot feature configurations.' },
  Configurations: { blurb: 'Server and bot setup commands, including feature and system configuration.' },
  'AI': { blurb: 'Components of the bot that require AI such as transcription.' },
  'Economy System and Games': { blurb: 'Server currency is earned from user activity and can be spent on economy features and store items.' },
  'Utilities and Bot Info': { blurb: 'Bot information and utility commands.' },
};

/**
 * @param {string | null} categoryName
 * @param {string | null} guildId
 * @param {import('discord.js').ClientUser | null | undefined} botUser
 * @returns {import('discord.js').EmbedBuilder}
 */
function buildEmbed(categoryName, guildId, botUser) {
  const embed = new EmbedBuilder()
    .setTitle('Command Categories')
    .setColor(0x5865f2)
    .setFooter({ text: SUPPORT_SERVER_LINE })
    .setTimestamp();

  const avatarURL = typeof botUser?.displayAvatarURL === 'function'
    ? botUser.displayAvatarURL({ size: 256 })
    : null;
  if (avatarURL) {
    embed.setThumbnail(avatarURL);
    embed.setAuthor({ name: botUser.username || 'Dussbot Help', iconURL: avatarURL });
  }

  try {
    const { applyDefaultColour } = require('../utils/guildColourStore');
    applyDefaultColour(embed, guildId);
  } catch (_) {}

  if (categoryName && categories[categoryName]) {
    const meta = categoryMeta[categoryName] || {};
    const blurb = meta.blurb ? `\n_${meta.blurb}_` : '';
    embed.setDescription(`**${categoryName} Commands**${blurb}`);
    embed.addFields(
      ...categories[categoryName].map(({ cmd, desc, perm }) => ({
        name: cmd,
        value: `_${desc}_${perm ? `\n> **Requires:** ${perm}` : ''}`,
        inline: false,
      })),
    );
    return embed;
  }

  embed.setDescription('Pick a category to view commands, expected usage, and permission requirements.');
  const overviewFields = Object.keys(categories).map((name) => {
    const meta = categoryMeta[name] || {};
    return {
      name,
      value: meta.blurb ? `_${meta.blurb}_` : '\u200b',
      inline: true,
    };
  });
  embed.addFields(...overviewFields);
  return embed;
}

/**
 * @param {string | null} selectedCategory
 * @param {string} ownerUserId
 * @returns {import('discord.js').ActionRowBuilder<import('discord.js').StringSelectMenuBuilder>[]}
 */
function buildHelpComponents(selectedCategory, ownerUserId) {
  const options = Object.keys(categories).map((name) => {
    const meta = categoryMeta[name] || {};
    const option = { label: name, value: name, default: name === selectedCategory };
    if (meta.blurb) option.description = meta.blurb.slice(0, 100);
    return option;
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${HELP_CATEGORY_ID_PREFIX}:${ownerUserId}`)
    .setPlaceholder('Browse a command category')
    .addOptions(options);
  const row = /** @type {import('discord.js').ActionRowBuilder<import('discord.js').StringSelectMenuBuilder>} */ (
    new ActionRowBuilder().addComponents(menu)
  );
  return [row];
}

module.exports = {
  HELP_CATEGORY_ID_PREFIX,
  buildHelpEmbed: buildEmbed,
  buildHelpComponents,
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with the bot'),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const embed = buildEmbed(null, interaction.guildId, interaction.client.user);
    const components = buildHelpComponents(null, interaction.user.id);
    await interaction.reply({
      embeds: [embed],
      components,
    });
  },
};

export {};


