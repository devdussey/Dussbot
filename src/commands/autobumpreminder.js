const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const store = require('../utils/autoBumpStore');
const scheduler = require('../utils/autoBumpScheduler');
const {
  getService,
  getDefaultIntervalMs,
} = require('../utils/autoBumpServices');

const TARGET_SERVICES = ['discadia', 'discodus', 'disboard'];
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const CUSTOM_MESSAGE_MAX = 1800;

const SERVICE_OPTION_MAP = {
  discadia: {
    interval: 'discadia_interval_minutes',
  },
  discodus: {
    interval: 'discodus_interval_minutes',
  },
  disboard: {
    interval: 'disboard_interval_minutes',
  },
};

function toMinutes(ms, fallback = 120) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.round(value / 60_000));
}

function sanitizeCommand(command, fallback = '') {
  const raw = String(command ?? fallback ?? '').trim();
  return raw.slice(0, 2000);
}

function sanitizeCustomMessage(message) {
  const raw = String(message || '').trim();
  return raw.slice(0, CUSTOM_MESSAGE_MAX);
}

function formatInlineMessage(command) {
  const value = String(command || '').replace(/`/g, '\'').slice(0, 120);
  return `\`${value || 'None'}\``;
}

function formatRelativeTime(timestampMs) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) return 'Not scheduled';
  return `<t:${Math.floor(ts / 1000)}:R>`;
}

function buildReminderMessage(serviceKey, roleId, customTemplate) {
  const serviceName = getService(serviceKey)?.name || serviceKey;
  const fallback = `Time to bump ${serviceName}. Run that listing bot's slash bump command now.`;
  const template = sanitizeCustomMessage(customTemplate);
  const body = template
    ? template.replace(/\{service\}/gi, serviceName)
    : fallback;
  const roleMention = roleId ? `<@&${roleId}>` : '';
  return sanitizeCommand(`${roleMention} ${body}`.trim());
}

function buildSetupChecklist(channelId, roleId) {
  const lines = [
    'Setup checklist:',
    `1) Keep this bot and bump bots in <#${channelId}>.`,
    '2) Give this bot `View Channel` and `Send Messages` there.',
    '3) Slash-only bump commands cannot be auto-run by another bot.',
    '4) Keep reminder intervals at or above each site cooldown.',
    '5) Have someone available to click/run the slash bump command after each reminder.',
  ];
  if (roleId) {
    lines.push(`6) Confirm this bot can mention <@&${roleId}> in that channel.`);
  }
  return lines.join('\n');
}

function getServiceConfig(interaction, serviceKey, roleId, customTemplate) {
  const optionNames = SERVICE_OPTION_MAP[serviceKey];
  const defaultIntervalMinutes = toMinutes(getDefaultIntervalMs(serviceKey), 120);
  const requestedMinutes = interaction.options.getInteger(optionNames.interval);
  const intervalMinutes = Math.max(
    1,
    Math.min(MAX_INTERVAL_MINUTES, Number(requestedMinutes) || defaultIntervalMinutes),
  );
  const intervalMs = intervalMinutes * 60_000;

  const command = buildReminderMessage(serviceKey, roleId, customTemplate);
  return {
    intervalMinutes,
    intervalMs,
    command,
    allowMentions: Boolean(roleId),
  };
}

async function removeDuplicateJobs(guildId, jobs) {
  let removed = 0;
  for (const job of jobs) {
    // eslint-disable-next-line no-await-in-loop
    const didRemove = await store.removeJob(guildId, job.id);
    if (didRemove) {
      scheduler.stopJob(guildId, job.id);
      removed += 1;
    }
  }
  return removed;
}

async function upsertServiceJob(guildId, channelId, serviceKey, serviceConfig) {
  const jobs = await store.listJobs(guildId);
  const matching = jobs
    .filter(job => job.service === serviceKey)
    .sort((a, b) => Number(a.id) - Number(b.id));

  const primary = matching[0] || null;
  const duplicates = matching.slice(1);
  const duplicateRemovals = await removeDuplicateJobs(guildId, duplicates);

  if (!primary) {
    const created = await store.addJob(guildId, {
      channelId,
      service: serviceKey,
      command: serviceConfig.command,
      intervalMs: serviceConfig.intervalMs,
      allowMentions: serviceConfig.allowMentions,
      startAfterMs: 60_000,
    });
    return { job: created, action: 'created', duplicateRemovals };
  }

  const requiresRecreate = String(primary.channelId) !== String(channelId)
    || Boolean(primary.allowMentions) !== Boolean(serviceConfig.allowMentions);

  if (requiresRecreate) {
    await store.removeJob(guildId, primary.id);
    scheduler.stopJob(guildId, primary.id);
    const recreated = await store.addJob(guildId, {
      channelId,
      service: serviceKey,
      command: serviceConfig.command,
      intervalMs: serviceConfig.intervalMs,
      allowMentions: serviceConfig.allowMentions,
      startAfterMs: 60_000,
    });
    return { job: recreated, action: 'recreated', duplicateRemovals };
  }

  await store.updateInterval(guildId, primary.id, serviceConfig.intervalMs);
  await store.updateCommand(guildId, primary.id, serviceConfig.command);
  const enabled = await store.setEnabled(guildId, primary.id, true);
  const refreshed = enabled || await store.getJob(guildId, primary.id);
  return { job: refreshed, action: 'updated', duplicateRemovals };
}

function formatConfiguredLine(serviceKey, result) {
  const serviceName = getService(serviceKey)?.name || serviceKey;
  const job = result.job;
  const actionLabel = result.action === 'created' ? 'Created' : result.action === 'recreated' ? 'Recreated' : 'Updated';
  return `${actionLabel} ${serviceName}: ${formatInlineMessage(job.command)} every ${toMinutes(job.intervalMs)}m in <#${job.channelId}> (next ${formatRelativeTime(job.nextRunAt)})`;
}

function formatStatusLine(job) {
  const serviceName = getService(job.service)?.name || job.service;
  const state = job.enabled ? 'ON' : 'OFF';
  const nextRun = job.enabled ? formatRelativeTime(job.nextRunAt) : 'Disabled';
  const errorSuffix = job.lastError ? ` | last error: ${String(job.lastError).slice(0, 120)}` : '';
  return `#${job.id} ${serviceName} [${state}] ${formatInlineMessage(job.command)} every ${toMinutes(job.intervalMs)}m in <#${job.channelId}> | next ${nextRun}${errorSuffix}`;
}

function sortTargetJobs(jobs) {
  const order = new Map(TARGET_SERVICES.map((key, index) => [key, index]));
  return jobs.slice().sort((a, b) => {
    const aOrder = order.has(a.service) ? order.get(a.service) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(b.service) ? order.get(b.service) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return Number(a.id) - Number(b.id);
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autobumpreminder')
    .setDescription('Configure automatic reminder messages for listing-site bumps')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Configure Discadia, Discodus, and Disboard bump reminders')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel where reminders should be sent')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addRoleOption(opt =>
          opt
            .setName('role')
            .setDescription('Optional role to tag in each reminder')
            .setRequired(false),
        )
        .addStringOption(opt =>
          opt
            .setName('message')
            .setDescription('Custom reminder text (optional). Use {service} to include site name.')
            .setMaxLength(CUSTOM_MESSAGE_MAX)
            .setRequired(false),
        )
        .addIntegerOption(opt =>
          opt
            .setName('discadia_interval_minutes')
            .setDescription('Discadia interval in minutes')
            .setMinValue(1)
            .setMaxValue(MAX_INTERVAL_MINUTES),
        )
        .addIntegerOption(opt =>
          opt
            .setName('discodus_interval_minutes')
            .setDescription('Discodus interval in minutes')
            .setMinValue(1)
            .setMaxValue(MAX_INTERVAL_MINUTES),
        )
        .addIntegerOption(opt =>
          opt
            .setName('disboard_interval_minutes')
            .setDescription('Disboard interval in minutes')
            .setMinValue(1)
            .setMaxValue(MAX_INTERVAL_MINUTES),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show bump reminder status for Discadia, Discodus, and Disboard'),
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable bump reminder jobs for Discadia, Discodus, and Disboard'),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
    }

    if (!interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Administrator permission is required to configure bump reminders.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'config') {
      const channel = interaction.options.getChannel('channel', true);
      if (!channel?.isTextBased?.()) {
        return interaction.editReply({ content: 'Select a valid text channel for reminder messages.' });
      }
      const role = interaction.options.getRole('role');
      const roleId = role?.id || null;
      const customMessageTemplate = sanitizeCustomMessage(interaction.options.getString('message'));

      const serviceConfigs = new Map();
      for (const serviceKey of TARGET_SERVICES) {
        const config = getServiceConfig(interaction, serviceKey, roleId, customMessageTemplate);
        if (!config.command) {
          const label = getService(serviceKey)?.name || serviceKey;
          return interaction.editReply({
            content: `${label} reminder text cannot be empty.`,
          });
        }
        serviceConfigs.set(serviceKey, config);
      }

      const results = [];
      let duplicateRemovals = 0;
      for (const serviceKey of TARGET_SERVICES) {
        const config = serviceConfigs.get(serviceKey);
        // eslint-disable-next-line no-await-in-loop
        const result = await upsertServiceJob(guildId, channel.id, serviceKey, config);
        results.push({ serviceKey, result });
        duplicateRemovals += result.duplicateRemovals || 0;
      }

      try {
        await scheduler.reloadGuild(interaction.client, guildId);
      } catch (_) {}

      const lines = [
        `Autobump reminder configured in <#${channel.id}>.`,
        roleId ? `Tagged role: <@&${roleId}>` : 'Tagged role: None',
        customMessageTemplate ? 'Custom message: Enabled' : 'Custom message: Default per service',
        '',
        ...results.map(item => formatConfiguredLine(item.serviceKey, item.result)),
      ];

      if (duplicateRemovals > 0) {
        lines.push('');
        lines.push(`Removed ${duplicateRemovals} duplicate reminder job(s).`);
      }

      lines.push('');
      lines.push(buildSetupChecklist(channel.id, roleId));
      lines.push('Use `/autobumpreminder status` to check timers or `/autobumpreminder disable` to pause all three.');

      return interaction.editReply({ content: lines.join('\n') });
    }

    if (sub === 'status') {
      const allJobs = await store.listJobs(guildId);
      const targetJobs = sortTargetJobs(allJobs.filter(job => TARGET_SERVICES.includes(job.service)));

      if (!targetJobs.length) {
        return interaction.editReply({
          content: [
            'No bump reminder jobs configured for Discadia/Discodus/Disboard yet.',
            'Run `/autobumpreminder config` and pick your reminder channel to start.',
          ].join('\n'),
        });
      }

      const lines = [
        'Autobump reminder status:',
        ...targetJobs.map(formatStatusLine),
      ];

      const referenceChannelId = targetJobs[0]?.channelId;
      const hasMentions = targetJobs.some(job => job.allowMentions);
      const reminderRoleId = hasMentions
        ? String(targetJobs[0].command || '').match(/<@&(\d{15,25})>/)?.[1] || null
        : null;
      if (referenceChannelId) {
        lines.push('');
        lines.push(buildSetupChecklist(referenceChannelId, reminderRoleId));
      }

      return interaction.editReply({ content: lines.join('\n') });
    }

    if (sub === 'disable') {
      const allJobs = await store.listJobs(guildId);
      const targetJobs = allJobs.filter(job => TARGET_SERVICES.includes(job.service));
      if (!targetJobs.length) {
        return interaction.editReply({ content: 'No Discadia/Discodus/Disboard reminder jobs are configured.' });
      }

      let disabled = 0;
      for (const job of targetJobs) {
        // eslint-disable-next-line no-await-in-loop
        const updated = await store.setEnabled(guildId, job.id, false);
        if (updated) disabled += 1;
        scheduler.stopJob(guildId, job.id);
      }

      try {
        await scheduler.reloadGuild(interaction.client, guildId);
      } catch (_) {}

      return interaction.editReply({
        content: `Disabled ${disabled} reminder job(s) for Discadia/Discodus/Disboard. Run \`/autobumpreminder config\` to re-enable.`,
      });
    }

    return interaction.editReply({ content: 'Unknown subcommand.' });
  },
};
