const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} = require('discord.js');
const { isOwner } = require('../utils/ownerIds');

const categories = {
  'Moderation & Enforcement': [
    { cmd: '/showbans', desc: 'Fetch and cache the server ban list for cross-server checks', perm: 'Ban Members' },
    { cmd: '/mute', desc: 'Timeout a member for a set duration (reason required)', perm: 'Moderate Members' },
    { cmd: '/kick', desc: 'Remove a member from the server with a required reason', perm: 'Kick Members' },
    { cmd: '/ban', desc: 'Ban a member with optional message pruning (reason required)', perm: 'Ban Members' },
    { cmd: '/purge', desc: 'Bulk delete 1-100 recent messages in the current channel', perm: 'Manage Messages' },
    { cmd: '/automodconfig', desc: 'Configure AI automod, log channel, and flag terms', perm: 'Administrator' },
    { cmd: '/blacklist add/remove/list', desc: 'Maintain a join blacklist that automatically bans flagged users', perm: 'Ban Members' },
    { cmd: '/jail config/add/remove/status', desc: 'Temporarily strip roles, isolate members, and restore them later', perm: 'Manage Roles' },
    { cmd: '/rupeeconfig', desc: 'Enable or disable Smite rewards and redemption', perm: 'Manage Server' },
  ],
  'Roles & Identity': [
    { cmd: '/autoroles add/remove/list/clear', desc: 'Automatically assign roles to new members', perm: 'Manage Roles' },
    { cmd: '/verify setup/status/disable/repost', desc: 'Set up button verification with optional account-age rules', perm: 'Manage Server' },
    { cmd: '/role create/delete/edit', desc: 'Create, delete, or rename custom roles without touching permissions', perm: 'Administrator' },
    { cmd: '/roleclean', desc: 'Find roles with zero members and delete them quickly', perm: 'Manage Roles' },
    { cmd: '/brconfig', desc: 'Post the booster role configuration panel', perm: 'Manage Server' },
  ],
  'Logging & Security': [
    { cmd: '/logmessageset & /logmessagemode (plus category variants)', desc: 'Ensure the tracked events are routed through dedicated channels', perm: 'Manage Server' },
    { cmd: '/logconfig', desc: 'Assign existing channels for every tracked log event', perm: 'Manage Server' },
    { cmd: '/memberlogconfig', desc: 'Configure member join/leave/boost logs and send test embeds', perm: 'Manage Server' },
    { cmd: '/botlogconfig', desc: 'Route bot joins, messages, and moderation actions to a channel', perm: 'Manage Server' },
    { cmd: '/tamperproof add/remove/list', desc: 'Watch channels for admin deletions and DM bot owners', perm: 'Manage Channels · Premium' },
    { cmd: '/antinuke config', desc: 'Configure anti-nuke safeguards and view their current status', perm: 'Manage Server' },
    { cmd: '/transriptconfig enable/disable/status', desc: 'Enable automatic voice transcription in chosen channels', perm: 'Manage Server' },
  ],
  'Server Setup & Messaging': [
    { cmd: '/confessconfig', desc: 'Post the anonymous confession button to a channel', perm: 'Manage Server' },
    { cmd: '/autobump add/remove/enable/disable/list', desc: 'Schedule automatic bumps for server listing sites', perm: 'Manage Server' },
    { cmd: '/channel create/edit', desc: 'Create or rename channels inside a category', perm: 'Administrator' },
    { cmd: '/channelsync', desc: 'Sync child channels with their category permissions', perm: 'Manage Channels' },
    { cmd: '/autorespond toggle/add/remove/list', desc: 'Automate keyword replies with optional channel filters', perm: 'Administrator' },
    { cmd: '/automessage create/delete/list', desc: 'Schedule automatic hourly messages or embeds', perm: 'Manage Server' },
    { cmd: '/say', desc: 'Send a custom message as the bot in any channel you specify', perm: 'Administrator' },
  ],
  'Media & Personalisation': [
    { cmd: '/chat', desc: 'Chat with GPT using selectable personas and context sizes', perm: null },
    { cmd: '/analysis', desc: 'Spend a Rupee to analyse your recent messages for insights', perm: null },
    { cmd: '/summarize', desc: 'Summarise recent channel messages into bullets and a paragraph', perm: null },
    { cmd: '/transcribe', desc: 'Transcribe an attached audio file using Whisper', perm: null },
    { cmd: '/removebg image/gif', desc: 'Remove the background from images or GIFs (GIFs return PNG via remove.bg) - 2 free uses/day without Premium', perm: 'Premium for unlimited access' },
    { cmd: '/enlarge emoji/sticker/media', desc: 'Post a large version of any emoji, sticker, or image/GIF (2x/4x/8x)', perm: null },
    { cmd: '/clone emoji/sticker', desc: 'Clone emojis or stickers by mention, ID, URL, or upload', perm: 'Manage Emojis and Stickers' },
    { cmd: '/cloneall', desc: 'Bulk clone emojis from another server with filters', perm: 'Manage Emojis and Stickers · Premium' },
  ],
  'Embeds & Branding': [
    { cmd: '/embed create/quick', desc: 'Use a guided builder or quick form to craft embeds', perm: null },
    { cmd: '/colour set/get/reset', desc: 'Manage the saved default embed colour for this server', perm: 'Manage Server' },
    { cmd: '/setdefaultcolour & /getdefaultcolour', desc: 'Quick commands to update or view the default embed colour', perm: 'Manage Server (setdefaultcolour)' },
  ],
  'Economy & Games': [
    { cmd: '/inventory', desc: 'Check your coins and rupees', perm: null },
    { cmd: '/rupeeboard', desc: 'View the rupee leaderboard for the server', perm: null },
    { cmd: '/rupeestore', desc: 'Spend rupees on nickname changes, custom roles, STFU, and Abuse Mod', perm: null },
    { cmd: '/blessing', desc: 'Claim a daily blessing worth 1 rupee', perm: null },
    { cmd: '/massblessing', desc: 'Give every user in the server 1 rupee', perm: 'Administrator' },
    { cmd: '/horserace', desc: 'Host a chaotic horse race mini-game with your server', perm: null },
    { cmd: '/horseracestandings', desc: 'Review historical podium finishes or personal stats', perm: null },
    { cmd: '/wordrush start', desc: 'Start a WordRush lobby (30s join button) - last player with lives wins', perm: null },
    { cmd: '/sentancerush start/end/settings', desc: 'SentenceRush lobby, stop, and settings (guess the hidden sentence)', perm: 'Manage Server (settings)' },
    { cmd: '/triviastart', desc: 'Start a multi-round trivia match in the channel', perm: null },
    { cmd: '/triviastop', desc: 'End an active trivia session early', perm: null },
    { cmd: '/triviacategories', desc: 'Browse the available trivia categories and difficulties', perm: null },
    { cmd: '/triviarankings', desc: 'Show the trivia leaderboard for this server', perm: null },
  ],
  'Utilities & Insights': [
    { cmd: '/avatar', desc: 'View any user’s avatar with quick download links', perm: null },
    { cmd: '/serverbanner', desc: 'Display and download the server banner', perm: null },
    { cmd: '/serverlogo', desc: 'Display and download the server icon', perm: null },
    { cmd: '/botinfo', desc: 'See which bot instance responded, uptime, and loaded commands', perm: null },
    { cmd: '/webhooks', desc: 'List every webhook in the server and its creator', perm: 'Manage Webhooks' },
  ],
  'Bot Owner': [
    { cmd: '/botlook', desc: 'Update the bot avatar, nickname, or bio', perm: 'Bot Owner' },
    { cmd: '/backup', desc: 'Create a snapshot backup of bans, channels, roles, and bots', perm: 'Bot Owner' },
    { cmd: '/backuplist', desc: 'List stored backups for this server', perm: 'Bot Owner' },
    { cmd: '/backupview', desc: 'Preview a backup and export JSON', perm: 'Bot Owner' },
    { cmd: '/backupdelete', desc: 'Delete a stored backup by id', perm: 'Bot Owner' },
    { cmd: '/fetchmessage', desc: 'Backfill user messages from a channel for analysis tools', perm: 'Bot Owner' },
    { cmd: '/giverupee', desc: 'Grant Rupees directly to a user', perm: 'Bot Owner or Guild Owner · Premium' },
    { cmd: '/wraith start/stop/preset', desc: 'Create a private spam channel and reuse saved presets or the modal', perm: 'Bot Owner + Premium' },
  ],
};

const categoryMeta = {
  'Moderation & Enforcement': {
    emoji: '🛡️',
    blurb: 'Act fast on rule breakers and keep order in your community.',
  },
  'Roles & Identity': {
    emoji: '🧩',
    blurb: 'Manage roles, verification, and booster perks with ease.',
  },
  'Logging & Security': {
    emoji: '🛰️',
    blurb: 'Audit key events and surface potential security concerns.',
  },
  'Server Setup & Messaging': {
    emoji: '🧰',
    blurb: 'Configure channels, announcements, and custom automations.',
  },
  'Media & Personalisation': {
    emoji: '🤖',
    blurb: 'Transform media and tap into AI-powered workflows.',
  },
  'Embeds & Branding': {
    emoji: '🖌️',
    blurb: 'Craft stunning embeds and customise booster flair.',
  },
  'Economy & Games': {
    emoji: '🎲',
    blurb: 'Reward activity, run events, and keep members entertained.',
  },
  'Utilities & Insights': {
    emoji: '🧭',
    blurb: 'Handy diagnostics and quick lookups for everyday needs.',
  },
  'Bot Owner': {
    emoji: '👑',
    blurb: 'Exclusive controls reserved for bot owners.',
  },
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
  'Bot Owner',
  'Guild Owner',
];

function extractPermissionTokens(rawPerm) {
  if (!rawPerm) return [];
  const lower = rawPerm.toLowerCase();
  const hits = PERMISSION_KEYWORDS.filter((label) =>
    lower.includes(label.toLowerCase())
  );
  if (hits.length) return hits;
  const cleaned = rawPerm.replace(/premium/gi, '').replace(/\s+/g, ' ').trim();
  return cleaned
    .split(/[,/]|·|\+|&/g)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token &&
        /^[A-Za-z][A-Za-z ().-]+$/.test(token)
    );
}

function formatCategoryPermissions(categoryName) {
  const commands = categories[categoryName] ?? [];
  const unique = new Set();
  commands.forEach(({ perm }) => {
    extractPermissionTokens(perm).forEach((token) => {
      if (!unique.has(token)) unique.add(token);
    });
  });
  if (!unique.size) return 'None (most commands are public)';
  return [...unique].join(' · ');
}

function buildEmbed(categoryName, includeOwner, guildId, botUser) {
  const embed = new EmbedBuilder()
    .setTitle('✨ Command Compass')
    .setColor(0x5865f2)
    .setFooter({
      text: 'Use the selector below to explore — it disables after one minute.',
    })
    .setTimestamp();

  const avatarURL =
    typeof botUser?.displayAvatarURL === 'function'
      ? botUser.displayAvatarURL({ size: 256 })
      : null;

  if (avatarURL) {
    embed.setThumbnail(avatarURL);
    embed.setAuthor({
      name: botUser.username ?? 'DisphoriaBot Help',
      iconURL: avatarURL,
    });
  }

  try {
    const { applyDefaultColour } = require('../utils/guildColourStore');
    applyDefaultColour(embed, guildId);
  } catch (_) {}

  if (categoryName && categories[categoryName]) {
    if (categoryName === 'Bot Owner' && !includeOwner) {
      embed.setDescription('Owner-only commands are hidden.');
      return embed;
    }
    const meta = categoryMeta[categoryName] ?? {};
    const emoji = meta.emoji ?? '📘';
    const blurb = meta.blurb ? `\n_${meta.blurb}_` : '';
    embed.setDescription(`${emoji} **${categoryName} Commands**${blurb}`);
    const fields = categories[categoryName].map(({ cmd, desc, perm }) => ({
      name: `${emoji} ${cmd}`,
      value: `_${desc}_${perm ? `\n> **Requires:** ${perm}` : ''}`,
      inline: false,
    }));
    embed.addFields(fields);
    return embed;
  }

  embed.setDescription(
    '✨ DisphoriaBot keeps your server safe, automated, and creative. Pick a category to see its tools and the permissions needed to run them.'
  );
  const cats = Object.keys(categories).filter(
    (cat) => !(cat === 'Bot Owner' && !includeOwner)
  );
  const overviewFields = cats.map((c) => {
    const { emoji, blurb } = categoryMeta[c] ?? {};
    const permText = formatCategoryPermissions(c);
    const lines = [];
    if (blurb) lines.push(`_${blurb}_`);
    lines.push(`> Requires: ${permText}`);
    return {
      name: `${emoji ?? '📘'} ${c}`,
      value: lines.join('\n'),
      inline: true,
    };
  });
  embed.addFields(
    ...overviewFields,
    {
      name: 'Need a quick tip?',
      value: 'Use `/help` anytime to reopen this menu or explore another category.',
    }
  );
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with the bot'),

  async execute(interaction) {
    const owner = isOwner(interaction.user.id);
    const embed = buildEmbed(
      null,
      owner,
      interaction.guildId,
      interaction.client.user
    );

    const options = Object.keys(categories)
      .filter((c) => !(c === 'Bot Owner' && !owner))
      .map((c) => {
        const meta = categoryMeta[c] ?? {};
        const option = { label: meta.emoji ? `${meta.emoji} ${c}` : c, value: c };
        if (meta.blurb) option.description = meta.blurb;
        return option;
      });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('help-category')
      .setPlaceholder('✨ Browse a command category')
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
      const catEmbed = buildEmbed(
        selected,
        owner,
        interaction.guildId,
        interaction.client.user
      );
      await i.update({ embeds: [catEmbed], components: [row] });
    });

    collector.on('end', () => {
      row.components[0].setDisabled(true);
      message.edit({ components: [row] }).catch(() => {});
    });
  },
};
