const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ComponentType } = require('discord.js');
const automodConfigStore = require('../utils/automodConfigStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

const fetch = globalThis.fetch;
const GLOBAL_AUTOMOD_OPENAI_KEY =
  process.env.AUTOMOD_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENAI_API;
const OPENAI_MODERATION_MODEL = 'omni-moderation-latest';

const VOTES_REQUIRED = 5;
const VOTE_WINDOW_MS = 2 * 60_000;
const MUTE_DURATION_MS = 60 * 60_000; // 1 hour

function normalizeContent(message) {
  return (message?.content || '').toLowerCase();
}

function findFlaggedTerm(content, terms) {
  const lower = content.toLowerCase();
  return terms.find(term => lower.includes(term.toLowerCase()));
}

function formatSnippet(content) {
  if (!content) return '_No content_';
  const trimmed = content.length > 300 ? `${content.slice(0, 297)}...` : content;
  return trimmed;
}

async function runOpenAiModeration(content, apiKey) {
  if (!apiKey || !content) return null;
  try {
    const resp = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODERATION_MODEL,
        input: content.slice(0, 2000),
      }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error('Automod OpenAI moderation API error:', text);
      return null;
    }
    const data = JSON.parse(text);
    const result = data?.results?.[0];
    if (!result || !result.flagged) return null;
    const categories = Object.entries(result.categories || {})
      .filter(([, flagged]) => flagged)
      .map(([name]) => name.replace(/_/g, ' '));
    const detail = categories.length
      ? `OpenAI moderation flagged (${categories.join(', ')})`
      : 'OpenAI moderation flagged this message.';
    return { categories, detail };
  } catch (err) {
    console.error('Automod OpenAI moderation failed:', err);
    return null;
  }
}

async function sendLog({ guild, logChannelId, embed }) {
  if (!logChannelId) return;
  try {
    const channel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Automod log send failed:', err);
  }
}

async function alertAdmins({ guild, logChannelId, targetUser }) {
  try {
    const channel = logChannelId
      ? await guild.channels.fetch(logChannelId).catch(() => null)
      : null;
    const ownerId = guild.ownerId;
    const mention = ownerId ? `<@${ownerId}>` : 'Admins';
    const content = `${mention} Automod mute triggered for ${targetUser.tag} (${targetUser.id}).`;
    const payload = { content, allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] } };
    if (channel && channel.isTextBased()) {
      await channel.send(payload);
    }
  } catch (err) {
    console.error('Automod admin alert failed:', err);
  }
}

function buildVoteRow(muteVotes, resolved, baseId) {
  const muteLabel = `Mute (${muteVotes}/${VOTES_REQUIRED})`;
  const disabled = resolved;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${baseId}:mute`)
      .setLabel(muteLabel)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (!message?.guild) return;
      if (message.author?.bot) return;

      const guildId = message.guild.id;
      const config = automodConfigStore.getConfig(guildId);
      if (!config.enabled) return;
      const whitelist = new Set(Array.isArray(config.whitelistUserIds) ? config.whitelistUserIds : []);
      if (whitelist.has(message.author.id)) return;
      const flagTerms = Array.isArray(config.flags) ? config.flags : [];
      const openaiKey = config.openaiApiKey || GLOBAL_AUTOMOD_OPENAI_KEY;
      const hasAi = Boolean(openaiKey);
      if (!flagTerms.length && !hasAi) return;

      const rawContent = message.content || '';
      const content = normalizeContent(message);
      const matchedTerm = flagTerms.length ? findFlaggedTerm(content, flagTerms) : null;
      let aiFlag = null;
      if (!matchedTerm && hasAi && rawContent.trim()) {
        aiFlag = await runOpenAiModeration(rawContent, openaiKey);
      }
      if (!matchedTerm && !aiFlag) return;

      const triggerText = matchedTerm
        ? `Flagged term: ${matchedTerm}`
        : aiFlag?.detail || 'OpenAI moderation flagged this message.';
      const triggerLogValue = matchedTerm
        ? matchedTerm
        : (aiFlag?.categories?.join(', ') || 'AI moderation');

      const color = resolveEmbedColour(guildId, 0xedc531);

      const publicEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle('Automod Flag')
        .setDescription(`${message.author} has been flagged for the following content:`)
        .addFields(
          { name: 'Message', value: formatSnippet(rawContent) || '_No content_' },
          { name: 'Trigger', value: triggerText.slice(0, 1024) },
        )
        .setFooter({ text: '5 votes for Mute will take action. If no action in 2 minutes, this vote will close.' })
        .setTimestamp(new Date());

      const logEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle('Automod Flag Logged')
        .addFields(
          { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
          { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
          { name: 'Trigger', value: triggerLogValue.slice(0, 1024), inline: true },
          { name: 'Content', value: formatSnippet(rawContent) || '_No content_', inline: false },
        )
        .setTimestamp(new Date());

      await sendLog({ guild: message.guild, logChannelId: config.logChannelId, embed: logEmbed });

      let muteVotes = 0;
      let resolved = false;

      const baseId = `automod-vote-${message.id}-${Date.now()}`;
      const row = buildVoteRow(muteVotes, resolved, baseId);

      const voteMessage = await message.channel.send({
        embeds: [publicEmbed],
        components: [row],
        allowedMentions: { users: [] },
      });

      const collector = voteMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: VOTE_WINDOW_MS,
      });

      const votersMute = new Set();

      const updateMessage = async () => {
        const updatedRow = buildVoteRow(muteVotes, resolved, baseId);
        try {
          await voteMessage.edit({ components: [updatedRow] });
        } catch (_) {}
      };

      const endWithResolution = async (actionTaken, errorMessage) => {
        resolved = true;
        const updatedEmbed = EmbedBuilder.from(publicEmbed);
        if (actionTaken) {
          updatedEmbed.setColor(0x57f287).setTitle(`Action taken: ${actionTaken}`);
        } else if (errorMessage) {
          updatedEmbed.setColor(0xed4245).setTitle('Action failed').setDescription(errorMessage);
        } else {
          updatedEmbed.setTitle('Voting closed').setColor(color);
        }
        try {
          await voteMessage.edit({
            embeds: [updatedEmbed],
            components: [buildVoteRow(muteVotes, true, baseId)],
          });
        } catch (_) {}
      };

      collector.on('collect', async (i) => {
        if (resolved) return;
        if (i.user.bot) return;
        if (!i.customId.startsWith(baseId)) return;

        const [, action] = i.customId.split(':');
        if (action === 'mute') {
          if (votersMute.has(i.user.id)) {
            await i.reply({ content: 'You already voted to mute.', ephemeral: true });
            return;
          }
          votersMute.add(i.user.id);
          muteVotes = votersMute.size;
        }

        await i.deferUpdate();
        await updateMessage();

        if (muteVotes >= VOTES_REQUIRED && !resolved) {
          resolved = true;
          const me = message.guild.members.me;
          const canMute = me?.permissions?.has(PermissionsBitField.Flags.ModerateMembers);
          if (!canMute) {
            await endWithResolution(null, 'Cannot mute: missing Moderate Members permission.');
            collector.stop('resolved');
            return;
          }
          const targetMember = await message.guild.members.fetch(message.author.id).catch(() => null);
          if (!targetMember || targetMember.id === me.id) {
            await endWithResolution(null, 'Cannot mute target.');
            collector.stop('resolved');
            return;
          }
          const higher = me.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;
          if (!higher || !targetMember.moderatable) {
            await endWithResolution(null, 'Cannot mute due to role hierarchy or permissions.');
            collector.stop('resolved');
            return;
          }
          try {
            await targetMember.timeout(MUTE_DURATION_MS, 'Automod community vote');
            await alertAdmins({ guild: message.guild, logChannelId: config.logChannelId, targetUser: targetMember.user });
            await endWithResolution('Mute (timeout applied)', null);
          } catch (err) {
            await endWithResolution(null, 'Failed to mute the user.');
          }
          collector.stop('resolved');
        }
      });

      collector.on('end', async () => {
        if (!resolved) {
          try { await voteMessage.delete(); } catch (_) {}
        }
      });
    } catch (err) {
      console.error('Automod message handler error:', err);
    }
  },
};
