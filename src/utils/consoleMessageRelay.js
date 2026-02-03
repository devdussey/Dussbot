const { EmbedBuilder } = require('discord.js');

const CHANNEL_ID = (process.env.CONSOLE_MESSAGES_CHANNELID || '').trim();
const MAX_DESCRIPTION_LENGTH = 4000;

function formatArg(arg) {
  try {
    if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
    if (typeof arg === 'object') return JSON.stringify(arg, null, 2);
    return String(arg);
  } catch (_) {
    try {
      return String(arg);
    } catch {
      return '[Unprintable]';
    }
  }
}

function truncate(value, max) {
  const str = value ?? '';
  if (str.length <= max) return str;
  return `${str.slice(0, max - 3)}...`;
}

function wrapCodeBlock(text) {
  if (!text) return '```\n\n```';
  return `\`\`\`\n${text}\n\`\`\``;
}

function createEmbed(title, description, color, fields = []) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp();
  if (description) embed.setDescription(description);
  if (fields.length) embed.addFields(fields);
  return embed;
}

function buildContextFields(extraFields = []) {
  const uptimeSeconds = Math.floor(process.uptime());
  const baseFields = [
    { name: 'PID', value: String(process.pid), inline: true },
    { name: 'Node', value: process.version, inline: true },
    { name: 'Uptime', value: `${uptimeSeconds}s`, inline: true },
  ];
  return baseFields.concat(extraFields);
}

function install(client) {
  if (!CHANNEL_ID || !client) return;

  const originalConsoleError = console.error.bind(console);
  const colors = {
    start: 0x57f287,
    restart: 0xfaa61a,
    shutdown: 0xed4245,
    error: 0xed4245,
  };

  let channelPromise = null;
  let channelRef = null;
  let disabled = false;
  const lifecycleSent = { start: false, shutdown: false, restart: false };

  async function resolveChannel() {
    if (disabled) return null;
    if (channelRef) return channelRef;
    if (!channelPromise) {
      channelPromise = (async () => {
        try {
          const cached = client.channels.cache.get(CHANNEL_ID);
          if (cached) return cached;
          return await client.channels.fetch(CHANNEL_ID);
        } catch (err) {
          originalConsoleError('[consoleMessageRelay] failed to fetch channel:', err);
          return null;
        }
      })();
    }
    try {
      const ch = await channelPromise;
      if (!ch || !ch.isTextBased?.()) {
        disabled = true;
        originalConsoleError('[consoleMessageRelay] channel is not text-based or unavailable');
        return null;
      }
      channelRef = ch;
      return ch;
    } catch (err) {
      disabled = true;
      originalConsoleError('[consoleMessageRelay] failed to resolve channel:', err);
      return null;
    }
  }

  async function sendEmbed(embed) {
    if (disabled) return false;
    const channel = await resolveChannel();
    if (!channel) return false;
    try {
      await channel.send({ embeds: [embed] });
      return true;
    } catch (err) {
      disabled = true;
      channelRef = null;
      originalConsoleError('[consoleMessageRelay] failed to send embed:', err);
      return false;
    }
  }

  async function notifyLifecycle({ key, title, description, color, fields = [] }) {
    if (!key) return;
    if (lifecycleSent[key]) return;
    const embed = createEmbed(
      title,
      description,
      color,
      buildContextFields(fields),
    );
    const success = await sendEmbed(embed);
    if (success) lifecycleSent[key] = true;
  }

  async function relayConsoleError(args) {
    const message = args.map(formatArg).join(' ');
    const errorArg = args.find((arg) => arg instanceof Error);
    const detail = errorArg?.stack || message || 'Unknown error';
    const truncated = truncate(detail, MAX_DESCRIPTION_LENGTH);
    const embed = createEmbed(
      'Console Error',
      wrapCodeBlock(truncated),
      colors.error,
      buildContextFields([{ name: 'Channel', value: CHANNEL_ID, inline: true }]),
    );
    if (message && message !== detail) {
      embed.addFields({ name: 'Message', value: wrapCodeBlock(truncate(message, 1000)) });
    }
    await sendEmbed(embed);
  }

  console.error = function (...args) {
    originalConsoleError(...args);
    void relayConsoleError(args);
  };

  void notifyLifecycle({
    key: 'start',
    title: 'Bot Start',
    description: `Ready ${client?.user?.tag || 'bot'} and serving ${client.guilds.cache.size} guilds.`,
    color: colors.start,
    fields: [{ name: 'Guilds', value: String(client.guilds.cache.size), inline: true }],
  });

  const signalMapping = [
    { signal: 'SIGINT', type: 'shutdown' },
    { signal: 'SIGTERM', type: 'shutdown' },
    { signal: 'SIGQUIT', type: 'shutdown' },
    { signal: 'SIGHUP', type: 'restart' },
    { signal: 'SIGUSR2', type: 'restart' },
  ];

  for (const { signal, type } of signalMapping) {
    try {
      const handler = () => {
        process.off(signal, handler);
        const signalDescription = `Received ${signal}`;
        void notifyLifecycle({
          key: type,
          title: type === 'restart' ? 'Bot Restart' : 'Bot Shutdown',
          description: `${signalDescription} while running.`,
          color: colors[type],
          fields: [
            { name: 'Signal', value: signal, inline: true },
            { name: 'Exit Code', value: String(process.exitCode ?? 0), inline: true },
          ],
        }).finally(() => {
          try {
            process.kill(process.pid, signal);
          } catch (_err) {
            process.exit();
          }
        });
      };
      process.on(signal, handler);
    } catch (err) {
      originalConsoleError('[consoleMessageRelay] failed to attach signal handler:', err);
    }
  }

  process.on('beforeExit', (code) => {
    void notifyLifecycle({
      key: 'shutdown',
      title: 'Bot Shutdown',
      description: `Process exiting (code ${code}).`,
      color: colors.shutdown,
      fields: [{ name: 'Exit Code', value: String(code), inline: true }],
    });
  });
}

module.exports = { install };
