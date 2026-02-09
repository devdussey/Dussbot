const { Events } = require('discord.js');
const wordStatsStore = require('../utils/wordStatsStore');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (!message?.guild) return;
        if (message.author?.bot) return;
        const authorTag = message.author?.tag || message.author?.username || message.author?.globalName || message.author?.id;
        try {
            await wordStatsStore.recordMessage(
                message.guild.id,
                message.author.id,
                authorTag,
                message.content || '',
            );
        } catch (err) {
            console.error('Failed to update word stats', err);
        }
    },
};
