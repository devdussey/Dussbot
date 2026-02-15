const { Events, ActivityType } = require('discord.js');
const consoleMessageRelay = require('../utils/consoleMessageRelay');
const healthchecksHeartbeat = require('../utils/healthchecksHeartbeat');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`${client.user.tag} is online and ready!`);
    console.log(`Serving ${client.guilds.cache.size} guilds`);

    const presenceName = "shmeatloaf";
    const status = "online";

    try {
      client.user.setPresence({
        activities: [{ name: presenceName, type: ActivityType.Playing }],
        status,
      });
    } catch (e) {
      console.warn('Failed to set presence:', e?.message || e);
    }

    // Install console.error relay to a Discord channel or owner DMs
    try {
      const relay = require('../utils/errorConsoleRelay');
      relay.install(client);
    } catch (e) {
      console.warn('Failed to install error console relay:', e?.message || e);
    }

    try {
      consoleMessageRelay.install(client);
    } catch (e) {
      console.warn('Failed to install console message relay:', e?.message || e);
    }

    try {
      healthchecksHeartbeat.install();
    } catch (e) {
      console.warn('Failed to start Healthchecks heartbeat:', e?.message || e);
    }

    // Start automessage scheduler for timed messages/embeds
    try {
      const autoMessageScheduler = require('../utils/autoMessageScheduler');
      await autoMessageScheduler.startAll(client);
    } catch (e) {
      console.warn('Failed to start automessage scheduler:', e?.message || e);
    }

  },
};
