const { Events } = require('discord.js');
const { ensureGuildConfig } = require('../utils/botConfigStore');

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    if (!guild?.id) return;
    try {
      ensureGuildConfig(guild.id);
    } catch (err) {
      console.error(`Failed to initialize bot config for guild ${guild.id}:`, err);
    }
  },
};
