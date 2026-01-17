const { Events, EmbedBuilder } = require('discord.js');
const messageLogStore = require('../utils/userMessageLogStore');
const rupeeStore = require('../utils/rupeeStore');
const smiteConfigStore = require('../utils/smiteConfigStore');
const { resolveEmbedColour } = require('../utils/guildColourStore');

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

    if (!smiteConfigStore.isEnabled(message.guild.id)) return;

    try {
      const result = await rupeeStore.incrementMessage(message.guild.id, message.author.id);
      if (!result?.awarded || result.awarded <= 0) return;

      const newBalance = Number.isFinite(result.tokens) ? result.tokens : rupeeStore.getBalance(message.guild.id, message.author.id);
      const amountText = result.awarded === 1 ? 'a rupee' : `${result.awarded} rupees`;
      const earnedText = `${message.author} has earned ${amountText}! They now have ${newBalance}!`;
      const embed = new EmbedBuilder()
        .setColor(resolveEmbedColour(message.guild.id, 0x00f0ff))
        .setDescription(`${earnedText}\n\nTo spend your rupees, type /rupeestore.`)
        .setThumbnail(message.author.displayAvatarURL({ extension: 'png', size: 256 }));
      try {
        await message.channel?.send({ embeds: [embed] });
      } catch (_) {}
    } catch (err) {
      console.error('Failed to award rupees', err);
    }
  },
};
