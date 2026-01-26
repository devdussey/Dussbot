const { Events } = require('discord.js');
const logSender = require('../utils/logSender');
const { buildLogEmbed } = require('../utils/logEmbedFactory');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;
      const oldContent = oldMessage.content?.slice(0, 1024) || '*No content*';
      const newContent = newMessage.content?.slice(0, 1024) || '*No content*';
      const embed = buildLogEmbed({
        action: 'Message Edited',
        target: newMessage.author,
        actor: newMessage.author,
        reason: 'Message content changed',
        color: 0xffd166,
        extraFields: [
          { name: 'Channel', value: `<#${newMessage.channel.id}> (${newMessage.channel.id})`, inline: true },
          { name: 'Old Content', value: oldContent, inline: false },
          { name: 'New Content', value: newContent, inline: false },
          { name: 'Message ID', value: newMessage.id, inline: true },
        ],
      });
      await logSender.sendLog({
        guildId: newMessage.guild.id,
        logType: 'message_edit',
        embed,
        client: newMessage.client,
      });
    } catch (err) {
      console.error('messageUpdate error:', err);
    }
  },
};
