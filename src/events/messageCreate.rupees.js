const { Events, EmbedBuilder } = require('discord.js');
const messageLogStore = require('../utils/userMessageLogStore');
const rupeeStore = require('../utils/rupeeStore');
const smiteConfigStore = require('../utils/smiteConfigStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');
const messageCountStore = require('../utils/messageCountStore');
const { buildRupeeEventEmbed } = require('../utils/rupeeLogEmbed');
const logSender = require('../utils/logSender');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message?.guild) return;
    if (message.author?.bot) return;

    try {
      await messageLogStore.recordMessage(message.guild.id, message.author.id, message);
    } catch (err) {
      console.error('Failed to update rupee message log', err);
    }

    try {
      await messageCountStore.recordMessage(
        message.guild.id,
        message.author.id,
        message.author?.tag || message.author?.username || message.author?.globalName || message.author?.id || null,
        message.createdTimestamp,
      );
    } catch (err) {
      console.error('Failed to update message leaderboard', err);
    }

    if (!smiteConfigStore.isEnabled(message.guild.id)) return;

    try {
      const result = await rupeeStore.incrementMessage(message.guild.id, message.author.id);
      if (!result?.awarded || result.awarded <= 0) return;

      const newBalance = Number.isFinite(result.tokens) ? result.tokens : rupeeStore.getBalance(message.guild.id, message.author.id);
      const amountText = result.awarded === 1 ? 'a rupee' : `${result.awarded} rupees`;
      const earnedText = `${message.author} has earned ${amountText}! They now have ${newBalance}!`;
      const announcement = `${earnedText}\n\nTo spend your rupees, type /rupeestore.`;
      try {
        const logEmbed = buildRupeeEventEmbed({
          guildId: message.guild.id,
          eventType: 'earned',
          actor: message.author,
          target: message.author,
          amount: result.awarded,
          balance: newBalance,
          method: `Message Activity (${rupeeStore.AWARD_THRESHOLD} messages)`,
        });
        await logSender.sendLog({
          guildId: message.guild.id,
          logType: 'rupee_earned',
          embed: logEmbed,
          client: message.client,
        });
      } catch (logErr) {
        console.error('Failed to send message rupee earn log', logErr);
      }
      const embed = new EmbedBuilder()
        .setColor(resolveEmbedColour(message.guild.id, 0x00f0ff))
        .setDescription(announcement)
        .setThumbnail(message.author.displayAvatarURL({ extension: 'png', size: 256 }));
      try {
        await message.channel?.send({ embeds: [embed] });
      } catch (_) {
        try {
          await message.channel?.send({
            content: announcement,
            allowedMentions: { users: [message.author.id] },
          });
        } catch (_) {}
      }
    } catch (err) {
      console.error('Failed to award rupees', err);
    }
  },
};
