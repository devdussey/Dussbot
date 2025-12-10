// Logs message events (create, delete, update) to the message log channel
const { Events, EmbedBuilder } = require('discord.js');
const logSender = require('../utils/logSender');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      // Only log guild messages from non-bots
      if (!message.guild || message.author?.bot) return;

      const embed = new EmbedBuilder()
        .setTitle('💬 Message Sent')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Author', value: `${message.author.tag} (${message.author.id})`, inline: false },
          { name: 'Channel', value: `<#${message.channel.id}> (${message.channel.id})`, inline: false },
          { name: 'Content', value: message.content?.slice(0, 1024) || '*No content*', inline: false },
          { name: 'Message ID', value: message.id, inline: true },
          { name: 'Attachments', value: message.attachments.size > 0 ? `${message.attachments.size} file(s)` : 'None', inline: true },
        )
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setTimestamp();

      await logSender.sendLog({
        guildId: message.guild.id,
        logType: 'message',
        embed,
        client: message.client,
      });
    } catch (err) {
      console.error('messageLog.MessageCreate error:', err);
    }
  },
};
