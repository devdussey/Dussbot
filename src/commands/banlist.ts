import path from 'node:path';
import { EmbedBuilder, PermissionsBitField, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommandModule } from '../types/runtime';

function requireFromSrcIfNeeded(modulePath: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath);
  } catch (_) {
    const srcPath = path.join(process.cwd(), 'src', modulePath.replace(/^\.\.\//, ''));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(srcPath);
  }
}

const banStore = requireFromSrcIfNeeded('../utils/banStore');
const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');

const maxEntries = 25;

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('Show the current ban list (optionally reply publicly).')
    .addBooleanOption((option) =>
      option
        .setName('public')
        .setDescription('Set to true to post the response publicly in this channel.')
        .setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
      return interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ content: 'You need the Ban Members permission to use this command.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ content: 'I need the Ban Members permission to read ban data.', ephemeral: true });
    }

    const wantPublic = interaction.options.getBoolean('public') === true;
    await interaction.deferReply({ ephemeral: !wantPublic });

    let bans: any;
    try {
      bans = await interaction.guild.bans.fetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return interaction.editReply({ content: `Failed to fetch bans: ${message}` });
    }

    const records = bans.map((ban: any) => ({
      userId: ban.user.id,
      reason: ban.reason || null,
      tag: typeof ban.user.tag === 'string' ? ban.user.tag : null,
    }));

    banStore.setGuildBans(interaction.guild.id, interaction.guild.name, records);

    if (!records.length) {
      return interaction.editReply({ content: 'No members are currently banned.' });
    }

    const lines = records.slice(0, maxEntries).map((ban: any, index: number) => {
      const tag = ban.tag || `Unknown (${ban.userId})`;
      const reason = ban.reason ? ban.reason.slice(0, 200) : 'No reason provided';
      return `${index + 1}. ${tag} — ${reason}`;
    });

    const extra = records.length > maxEntries ? `\n…and ${records.length - maxEntries} more.` : '';
    const embed = new EmbedBuilder()
      .setTitle(`Banned members in ${interaction.guild.name}`)
      .setDescription(`${lines.join('\n')}${extra}`)
      .setColor(resolveEmbedColour(interaction.guildId, 0xff0000))
      .setFooter({ text: `Synced ${records.length} ban(s)` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export = command;
