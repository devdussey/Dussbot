import path from 'node:path';
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
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

const { resolveEmbedColour } = requireFromSrcIfNeeded('../utils/guildColourStore');
const { getSupportServerUrl } = requireFromSrcIfNeeded('../utils/supportServer');
const { getLegalLinks } = requireFromSrcIfNeeded('../utils/legalLinks');

function formatUptime(ms: number) {
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / (60 * 1000)) % 60;
  const hr = Math.floor(ms / (60 * 60 * 1000)) % 24;
  const day = Math.floor(ms / (24 * 60 * 60 * 1000));
  const parts: string[] = [];
  if (day) parts.push(`${day}d`);
  if (hr) parts.push(`${hr}h`);
  if (min) parts.push(`${min}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

const command: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Show which bot instance is responding and environment details'),

  async execute(interaction: ChatInputCommandInteraction) {
    const client = interaction.client;
    const user = client.user;
    const mode = process.env.NODE_ENV || 'production';
    const appId = process.env.CLIENT_ID || 'unknown';
    const supportServerUrl = getSupportServerUrl();
    const { termsOfServiceUrl, privacyPolicyUrl } = getLegalLinks();
    const guildDeploy = mode === 'development' && process.env.GUILD_ID
      ? `Guild-scoped to ${process.env.GUILD_ID}`
      : 'Global commands';
    const uptime = formatUptime(process.uptime() * 1000);

    const embed = new EmbedBuilder()
      .setTitle('Bot Info')
      .setColor(resolveEmbedColour(interaction.guildId, 0x0000ff))
      .addFields(
        { name: 'Bot', value: `${user.tag} (${user.id})`, inline: false },
        { name: 'Application ID', value: appId, inline: false },
        { name: 'Mode', value: mode, inline: true },
        { name: 'Deploy', value: guildDeploy, inline: true },
        { name: 'Commands Loaded', value: String(client.commands?.size ?? 0), inline: true },
        { name: 'Uptime', value: uptime, inline: true },
        { name: 'Support Server', value: supportServerUrl, inline: false },
        { name: 'Terms of Service', value: termsOfServiceUrl || 'Not configured (set TERMS_OF_SERVICE_URL)', inline: false },
        { name: 'Privacy Policy', value: privacyPolicyUrl || 'Not configured (set PRIVACY_POLICY_URL)', inline: false },
      )
      .setThumbnail(user.displayAvatarURL());

    try {
      await interaction.reply({ embeds: [embed] });
    } catch (_) {
      if (interaction.channel?.send) {
        await interaction.channel.send({ content: `Bot info for <@${interaction.user.id}>:`, embeds: [embed] });
      }
    }
  },
};

export = command;
