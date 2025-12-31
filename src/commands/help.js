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
    { cmd: '/purge', desc: 'Bulk delete 1ΓÇô100 recent messages in the current channel', perm: 'Manage Messages' },
    { cmd: '/blacklist add/remove/list', desc: 'Maintain a join blacklist that automatically bans flagged users', perm: 'Ban Members' },
    { cmd: '/jail config/add/remove/status', desc: 'Temporarily strip roles, isolate members, and restore them later', perm: 'Manage Roles' },
    { cmd: '/stfu', desc: 'Spend a Smite to silence a non-staff user for ten minutes', perm: null },
    { cmd: '/rupeeconfig', desc: 'Enable or disable Smite rewards and redemption', perm: 'Manage Server' },
  ],
  'Roles & Identity': [
    { cmd: '/role add/remove', desc: 'Grant or remove specific roles from a member', perm: 'Manage Roles' },
    { cmd: '/autoroles add/remove/list/clear', desc: 'Automatically assign roles to new members', perm: 'Manage Roles' },
    { cmd: '/verify setup/status/disable/repost', desc: 'Set up button verification with optional account-age rules', perm: 'Manage Server' },
    { cmd: '/createrole', desc: 'Create a role with colour, hoist, mentionable, and position options', perm: 'Manage Roles' },
    { cmd: '/deleterole', desc: 'Delete a role from the server', perm: 'Manage Roles' },
    { cmd: '/brconfig', desc: 'Post the booster role configuration panel', perm: 'Manage Server' },
  ],
  'Logging & Security': [
    { cmd: '/logmessageset & /logmessagemode (plus category variants)', desc: 'Ensure the tracked events are routed through dedicated channels', perm: 'Manage Server' },
    { cmd: '/logconfig', desc: 'Create or sync dedicated channels for every tracked log event', perm: 'Manage Server' },
    { cmd: '/tamperproof add/remove/list', desc: 'Watch channels for admin deletions and DM bot owners', perm: 'Manage Channels ┬╖ Premium' },
    { cmd: '/antinuke config', desc: 'Configure anti-nuke safeguards and view their current status', perm: 'Manage Server' },
    { cmd: '/transriptconfig enable/disable/status', desc: 'Enable automatic voice transcription in chosen channels', perm: 'Manage Server' },
  ],
  'Server Setup & Messaging': [
    { cmd: '/welcome setup/status/disable/test', desc: 'Build and manage welcome messages for new members', perm: 'Manage Server' },
    { cmd: '/confessconfig', desc: 'Post the anonymous confession button to a channel', perm: 'Manage Server' },
    { cmd: '/autobump add/remove/enable/disable/list', desc: 'Schedule automatic bumps for server listing sites', perm: 'Manage Server' },
    { cmd: '/createchannel', desc: 'Quickly create text, voice, or stage channels with optional category', perm: 'Manage Channels' },
    { cmd: '/channelsync', desc: 'Sync child channels with their category permissions', perm: 'Manage Channels' },
    { cmd: '/autorespond toggle/add/remove/list', desc: 'Automate keyword replies with optional channel filters', perm: 'Administrator' },
    { cmd: '/repeat start/stop/list', desc: 'Schedule repeating messages every N seconds (ΓëÑ 60)', perm: 'Administrator' },
    { cmd: '/say', desc: 'Send a custom message as the bot in any channel you specify', perm: 'Administrator' },
  ],
  'Media & Personalisation': [
    { cmd: '/chat', desc: 'Chat with GPT using selectable personas and context sizes', perm: null },
    { cmd: '/analysis', desc: 'Spend a Rupee to analyse your recent messages for insights', perm: null },
    { cmd: '/summarize', desc: 'Summarise recent channel messages into bullets and a paragraph', perm: null },
    { cmd: '/transcribe', desc: 'Transcribe an attached audio file using Whisper', perm: null },
    { cmd: '/removebg', desc: 'Remove the background from an image via remove.bg (2 free uses/day without Premium)', perm: 'Premium for unlimited access' },
    { cmd: '/imageresize', desc: 'Resize an image and convert it to PNG', perm: null },
    { cmd: '/enlarge emoji/sticker', desc: 'Post a large version of any emoji or sticker', perm: null },
    { cmd: '/clone emoji/sticker', desc: 'Clone emojis or stickers by mention, ID, URL, or upload', perm: 'Manage Emojis and Stickers' },
    { cmd: '/cloneall', desc: 'Bulk clone emojis from another server with filters', perm: 'Manage Emojis and Stickers ┬╖ Premium' },
    { cmd: '/font', desc: 'Transform your message with decorative Unicode fonts', perm: null },
  ],
  'Embeds & Branding': [
    { cmd: '/embed create/quick', desc: 'Use a guided builder or quick form to craft embeds', perm: null },
    { cmd: '/getembed', desc: 'Extract embed JSON from a message for reuse', perm: null },
    { cmd: '/colour set/get/reset', desc: 'Manage the saved default embed colour for this server', perm: 'Manage Server' },
    { cmd: '/setdefaultcolour & /getdefaultcolour', desc: 'Quick commands to update or view the default embed colour', perm: 'Manage Server (setdefaultcolour)' },
  ],
  'Economy & Games': [
    { cmd: '/inventory', desc: 'Check your coins plus available Smites and Rupees', perm: null },
    { cmd: '/viewrupees', desc: 'Admins: view a rupee balance leaderboard for the server', perm: 'Administrator' },
    { cmd: '/store', desc: 'Spend coins on Smite Tomes or Rupees', perm: null },
    { cmd: '/pray', desc: 'Pray once per day to receive a coin blessing', perm: null },
    { cmd: '/horserace', desc: 'Host a chaotic horse race mini-game with your server', perm: null },
    { cmd: '/horseracestandings', desc: 'Review historical podium finishes or personal stats', perm: null },
    { cmd: '/wordrush start', desc: 'Start a WordRush lobby (30s join button) - last player with lives wins', perm: null },
    { cmd: '/triviastart', desc: 'Start a multi-round trivia match in the channel', perm: null },
    { cmd: '/triviastop', desc: 'End an active trivia session early', perm: null },
    { cmd: '/triviacategories', desc: 'Browse the available trivia categories and difficulties', perm: null },
    { cmd: '/triviarankings', desc: 'Show the trivia leaderboard for this server', perm: null },
  ],
  'Utilities & Insights': [
    { cmd: '/avatar', desc: 'View any userΓÇÖs avatar with quick download links', perm: null },
    { cmd: '/serverbanner', desc: 'Display and download the server banner', perm: null },
    { cmd: '/serverlogo', desc: 'Display and download the server icon', perm: null },
    { cmd: '/botinfo', desc: 'See which bot instance responded, uptime, and loaded commands', perm: null },
    { cmd: '/webhooks', desc: 'List every webhook in the server and its creator', perm: 'Manage Webhooks' },
  ],
  Premium: [
    { cmd: '/wraith start/stop', desc: 'Isolate a member with relentless pings and Wraith embeds (modal setup)', perm: 'Bot Owner ┬╖ Premium' },
    { cmd: '/tamperproof add/remove/list', desc: 'Monitor channels for deletion tampering alerts', perm: 'Manage Channels ┬╖ Premium' },
    { cmd: '/giverupee', desc: 'Grant Rupees directly with a Premium token', perm: 'Bot Owner or Guild Owner ┬╖ Premium' },
    { cmd: '/cloneall', desc: 'Bulk import emojis from another server', perm: 'Manage Emojis and Stickers ┬╖ Premium' },
    { cmd: '/removebg', desc: 'Unlimited background removals (2 free/day without Premium)', perm: 'Premium for unlimited access' },
  ],
  'Bot Owner': [
    { cmd: '/botlook', desc: 'Update the bot avatar, nickname, or bio', perm: 'Bot Owner' },
    { cmd: '/backup', desc: 'Create a snapshot backup of bans, channels, roles, and bots', perm: 'Bot Owner' },
    { cmd: '/backuplist', desc: 'List stored backups for this server', perm: 'Bot Owner' },
    { cmd: '/backupview', desc: 'Preview a backup and export JSON', perm: 'Bot Owner' },
    { cmd: '/backupdelete', desc: 'Delete a stored backup by id', perm: 'Bot Owner' },
    { cmd: '/fetchmessage', desc: 'Backfill user messages from a channel for analysis tools', perm: 'Bot Owner' },
    { cmd: '/dmdiag test/role', desc: 'Run DM diagnostics for a member or role', perm: 'Bot Owner' },
    { cmd: '/giverupee', desc: 'Grant Rupees directly to a user', perm: 'Bot Owner or Guild Owner ┬╖ Premium' },
    { cmd: '/wraith start/stop', desc: 'Create a private spam channel and isolate a member (modal setup)', perm: 'Bot Owner ┬╖ Premium' },
  ],
};

const categoryMeta = {
  'Moderation & Enforcement': {
    emoji: '≡ƒ¢í∩╕Å',
    blurb: 'Act fast on rule breakers and keep order in your community.',
  },
  'Roles & Identity': {
    emoji: '≡ƒº⌐',
    blurb: 'Manage roles, verification, and booster perks with ease.',
  },
  'Logging & Security': {
    emoji: '≡ƒ¢░∩╕Å',
    blurb: 'Audit key events and surface potential security concerns.',
  },
  'Server Setup & Messaging': {
    emoji: '≡ƒº░',
    blurb: 'Configure channels, announcements, and custom automations.',
  },
  'Media & Personalisation': {
    emoji: '≡ƒñû',
    blurb: 'Transform media and tap into AI-powered workflows.',
  },
  'Embeds & Branding': {
    emoji: '≡ƒûî∩╕Å',
    blurb: 'Craft stunning embeds and customise booster flair.',
  },
  'Economy & Games': {
    emoji: '≡ƒÄ▓',
    blurb: 'Reward activity, run events, and keep members entertained.',
  },
  'Utilities & Insights': {
    emoji: '≡ƒº¡',
    blurb: 'Handy diagnostics and quick lookups for everyday needs.',
  },
  Premium: {
    emoji: '≡ƒÆÄ',
    blurb: 'Unlock with $4.99 or an active Server Boost. Votes grant 12 hours of access.',
  },
  'Bot Owner': {
    emoji: '≡ƒææ',
    blurb: 'Exclusive controls reserved for bot owners.',
  },
};

function buildEmbed(categoryName, includeOwner, guildId, botUser) {
  const embed = new EmbedBuilder()
    .setTitle('Γ£¿ Command Compass')
    .setColor(0x5865f2)
    .setFooter({
      text: 'Use the selector below to explore ΓÇö it disables after one minute.',
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
    const emoji = meta.emoji ?? '≡ƒôÿ';
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

  embed.setDescription('Γ£¿ Explore the command vault and find the perfect tool in seconds.');
  const cats = Object.keys(categories).filter(
    (cat) => !(cat === 'Bot Owner' && !includeOwner)
  );
  const value = cats
    .map((c) => {
      const { emoji, blurb } = categoryMeta[c] ?? {};
      const accent = blurb ? ` ΓÇö ${blurb}` : '';
      return `${emoji ?? '≡ƒôÿ'} **${c}**${accent}`;
    })
    .join('\n');
  embed.addFields(
    { name: '≡ƒôÜ Categories', value },
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
        const option = { label: c, value: c };
        if (meta.emoji) option.emoji = meta.emoji;
        if (meta.blurb) option.description = meta.blurb;
        return option;
      });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('help-category')
      .setPlaceholder('Γ£¿ Browse a command category')
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
