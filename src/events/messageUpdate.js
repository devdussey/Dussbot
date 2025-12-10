// Logs message edits to the message log channel
const { Events, EmbedBuilder } = require('discord.js');
const logSender = require('../utils/logSender');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    try {
      // Only log guild messages from non-bots
      if (!newMessage.guild || newMessage.author?.bot) return;

      // Only log if content actually changed (avoid logging embed/other updates)
      if (oldMessage.content === newMessage.content) return;

      const oldContent = oldMessage.content?.slice(0, 1024) || '*No content*';
      const newContent = newMessage.content?.slice(0, 1024) || '*No content*';

      const embed = new EmbedBuilder()
        .setTitle('✏️ Message Edited')
        .setColor(0xffa500)
        .addFields(
          { name: 'Author', value: `${newMessage.author.tag} (${newMessage.author.id})`, inline: false },
          { name: 'Channel', value: `<#${newMessage.channel.id}> (${newMessage.channel.id})`, inline: false },
          { name: 'Old Content', value: oldContent, inline: false },
          { name: 'New Content', value: newContent, inline: false },
          { name: 'Message ID', value: newMessage.id, inline: true },
          { name: 'Link', value: `[Jump to message](${newMessage.url})`, inline: true },
        )
        .setAuthor({ name: newMessage.author.tag, iconURL: newMessage.author.displayAvatarURL() })
        .setTimestamp();

      await logSender.sendLog({
        guildId: newMessage.guild.id,
        logType: 'message',
        embed,
        client: newMessage.client,
      });
    } catch (err) {
      console.error('messageUpdate error:', err);
    }
  },
};
