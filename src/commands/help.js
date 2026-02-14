const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} = require('discord.js');

const SUPPORT_SERVER_LINE = 'For more detailed help and updates, join the support server https://discord.gg/d83rZnXETm';

const categories = {
  'Moderation & Enforcement': [
    { cmd: '/banlist', desc: 'List current bans in the server.', perm: 'Ban Members' },
    { cmd: '/mute', desc: 'Timeout a member for a set duration (reason required).', perm: 'Moderate Members' },
    { cmd: '/kick', desc: 'Remove a member from the server (reason required).', perm: 'Kick Members' },
    { cmd: '/ban', desc: 'Ban a member with optional prune window (reason required).', perm: 'Ban Members' },
    { cmd: '/unban', desc: 'Lift a ban with a reason.', perm: 'Ban Members' },
    { cmd: '/unmute', desc: 'Remove a timeout with a reason.', perm: 'Moderate Members' },
    { cmd: '/automodconfig', desc: 'Configure AI automod, review actions, and filters.', perm: 'Administrator' },
  ],
  Administration: [
    { cmd: '/modconfig', desc: 'Configure the moderator role and mod log channel.', perm: 'Manage Server' },
    { cmd: '/role create/delete/edit/clean', desc: 'Manage roles and clean empty roles.', perm: 'Administrator' },
    { cmd: '/boosterroleconfig', desc: 'Post the booster role configuration panel.', perm: 'Manage Server' },
    { cmd: '/channel create/edit/sync', desc: 'Create, rename, or sync channel permissions to category.', perm: 'Administrator' },
    { cmd: '/autoroles add/remove/list/clear', desc: 'Manage automatic role assignment for joins.', perm: 'Manage Roles' },
    { cmd: '/confessconfig', desc: 'Post the anonymous confession panel.', perm: 'Manage Server' },
    { cmd: '/suggestconfig', desc: 'Post the anonymous suggestion panel.', perm: 'Manage Server' },
    { cmd: '/sacrificeconfig', desc: 'Post the communal sacrifice panel.', perm: 'Administrator' },
    { cmd: '/autorespond toggle/add/remove/list', desc: 'Configure keyword-based automated replies.', perm: 'Administrator' },
    { cmd: '/automessage create/delete/list', desc: 'Schedule recurring server messages.', perm: 'Manage Server' },
    { cmd: '/say', desc: 'Send a custom bot message to a selected channel.', perm: 'Administrator' },
    { cmd: '/logconfig', desc: 'Configure logging channels and toggle events.', perm: 'Administrator' },
    { cmd: '/antinuke config', desc: 'Configure anti-nuke detections and thresholds.', perm: 'Manage Server' },
    { cmd: '/transcriptconfig enable/disable/status', desc: 'Manage voice transcription automation.', perm: 'Manage Server' },
    { cmd: '/purge', desc: 'Bulk delete up to 100 recent messages.', perm: 'Manage Messages' },
    { cmd: '/webhooks', desc: 'List server webhooks and creators.', perm: 'Administrator' },
    { cmd: '/giverupee', desc: 'Grant rupees directly to a user.', perm: 'Administrator' },
    { cmd: '/massblessing', desc: 'Give every non-bot user rupees.', perm: 'Administrator' },
    { cmd: '/embed create/quick', desc: 'Build embeds through guided tools.', perm: 'Administrator' },
    { cmd: '/colour set/get/reset', desc: 'Manage default embed colour for this server.', perm: 'Manage Server' },
    { cmd: '/botsettings', desc: 'View bot settings and change default embed colour.', perm: 'Administrator' },
    { cmd: '/rupeeconfig', desc: 'Configure Rupee rewards, store prices, immunity role, and rupee channels.', perm: 'Manage Server' },
  ],
  'Media & Personalisation': [
    { cmd: '/chat', desc: 'Chat with the AI assistant.', perm: null },
    { cmd: '/analysis', desc: 'Spend a Rupee to analyze your recent messages.', perm: null },
    { cmd: '/summarize', desc: 'Summarize recent channel discussion.', perm: null },
    { cmd: '/transcribe', desc: 'Transcribe an attached audio file.', perm: null },
    { cmd: '/removebg image/gif', desc: 'Remove image background (non-premium servers: 1 use/day).', perm: 'Premium server for unlimited' },
    { cmd: '/enlarge emoji/sticker/media', desc: 'Upscale emojis, stickers, and media.', perm: null },
    { cmd: '/clone emoji/sticker', desc: 'Clone an emoji or sticker.', perm: 'Manage Emojis and Stickers' },
  ],
  'Rupee System': [
    { cmd: '/inventory', desc: 'View your coins and rupees.', perm: null },
    { cmd: '/rupeeboard', desc: 'View the server rupee leaderboard.', perm: null },
    { cmd: '/rupeestore', desc: 'Spend rupees on store items and actions.', perm: null },
    { cmd: '/rupeeconfig', desc: 'Configure Rupee rewards, store prices, immunity role, and rupee channels.', perm: 'Manage Server' },
    { cmd: '/blessing', desc: 'Claim your daily blessing rupee.', perm: 'Administrator' },
    { cmd: '/horserace', desc: 'Start a race with live betting and payouts.', perm: null },
    { cmd: '/horseracestandings', desc: 'View race podium history and stats.', perm: null },
    { cmd: '/wordrush start', desc: 'Start a WordRush lobby.', perm: null },
  ],
  'Utilities & Insights': [
    { cmd: '/avatar', desc: 'Display user avatar and download links.', perm: null },
    { cmd: '/serverbanner', desc: 'Display and download server banner.', perm: null },
    { cmd: '/serverlogo', desc: 'Display and download server icon.', perm: null },
    { cmd: '/botinfo', desc: 'View bot instance and uptime info.', perm: null },
  ],
};

const categoryMeta = {
  'Moderation & Enforcement': { blurb: 'Moderation actions and enforcement controls.' },
  Administration: { blurb: 'Commands to make administration tasks simple and easy. Also includes bot feature configurations.' },
  'Media & Personalisation': { blurb: 'AI and media transformation tools.' },
  'Rupee System': { blurb: 'Rupee systems and game commands.' },
  'Utilities & Insights': { blurb: 'Everyday utility commands and diagnostics.' },
};

const PERMISSION_KEYWORDS = [
  'Administrator',
  'Manage Server',
  'Manage Channels',
  'Manage Roles',
  'Manage Messages',
  'Manage Emojis and Stickers',
  'Manage Webhooks',
  'Moderate Members',
  'Kick Members',
  'Ban Members',
];

function extractPermissionTokens(rawPerm) {
  if (!rawPerm) return [];
  const lower = rawPerm.toLowerCase();
  const hits = PERMISSION_KEYWORDS.filter(label => lower.includes(label.toLowerCase()));
  if (hits.length) return hits;
  return String(rawPerm)
    .replace(/premium/gi, '')
    .split(/[,/]|·|\+|&/g)
    .map(token => token.trim())
    .filter(Boolean);
}

function formatCategoryPermissions(categoryName) {
  const commands = categories[categoryName] || [];
  const unique = new Set();
  for (const { perm } of commands) {
    for (const token of extractPermissionTokens(perm)) unique.add(token);
  }
  if (!unique.size) return 'None (mostly public commands)';
  return [...unique].join(' · ');
}

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
    const lines = [];
    if (meta.blurb) lines.push(`_${meta.blurb}_`);
    lines.push(`> Requires: ${formatCategoryPermissions(name)}`);
    return {
      name,
      value: lines.join('\n'),
      inline: true,
    };
  });
  embed.addFields(...overviewFields);
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with the bot'),

  async execute(interaction) {
    const embed = buildEmbed(null, interaction.guildId, interaction.client.user);
    const options = Object.keys(categories).map((name) => {
      const meta = categoryMeta[name] || {};
      const option = { label: name, value: name };
      if (meta.blurb) option.description = meta.blurb.slice(0, 100);
      return option;
    });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('help-category')
      .setPlaceholder('Browse a command category')
      .addOptions(options);
    const row = new ActionRowBuilder().addComponents(menu);

    const message = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 60_000,
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'This menu is not for you.', ephemeral: true });
      }
      const selected = i.values[0];
      const catEmbed = buildEmbed(selected, interaction.guildId, interaction.client.user);
      await i.update({ embeds: [catEmbed], components: [row] });
    });

    collector.on('end', () => {
      row.components[0].setDisabled(true);
      message.edit({ components: [row] }).catch(() => {});
    });
  },
};
