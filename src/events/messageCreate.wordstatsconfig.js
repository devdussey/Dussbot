const { Events } = require('discord.js');
const { recordTrackedMessage } = require('../utils/wordStatsConfigStore');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message?.guild) return;
    if (message.author?.bot) return;
    try {
      const authorTag = message.author?.tag || message.author?.username || message.author?.id;
      await recordTrackedMessage(message.guild.id, message.channelId, message.author.id, authorTag);
    } catch (err) {
      console.error('Failed to update configured word stats message counts', err);
    }
  },
};
