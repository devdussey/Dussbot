const LOG_KEYS = {
  message: {
    label: 'All Message Events',
    category: 'Message',
  },
  media: {
    label: 'All Media Events',
    category: 'Media',
  },
  media_posted: {
    label: 'Media Posted',
    category: 'Media',
    fallbackKey: 'media',
  },
  message_create: {
    label: 'Message Created',
    category: 'Message',
    fallbackKey: 'message',
  },
  message_delete: {
    label: 'Message Deleted',
    category: 'Message',
    fallbackKey: 'message',
  },
  message_edit: {
    label: 'Message Edited',
    category: 'Message',
    fallbackKey: 'message',
  },

  member: {
    label: 'All Member Events',
    category: 'Member',
  },
  member_join: {
    label: 'Member Joined',
    category: 'Member',
    fallbackKey: 'member',
  },
  member_leave: {
    label: 'Member Left',
    category: 'Member',
    fallbackKey: 'member',
  },

  moderation: {
    label: 'All Moderation Events',
    category: 'Moderation',
  },
  member_ban: {
    label: 'User Banned',
    category: 'Moderation',
    fallbackKey: 'moderation',
  },
  member_unban: {
    label: 'User Unbanned',
    category: 'Moderation',
    fallbackKey: 'moderation',
  },
  member_kick: {
    label: 'User Kicked',
    category: 'Moderation',
    fallbackKey: 'moderation',
  },
  member_timeout: {
    label: 'User Timed Out',
    category: 'Moderation',
    fallbackKey: 'moderation',
  },
  member_untimeout: {
    label: 'User Timeout Removed',
    category: 'Moderation',
    fallbackKey: 'moderation',
  },
  messages_purged: {
    label: 'Messages Purged',
    category: 'Moderation',
    fallbackKey: 'moderation',
  },

  channel: {
    label: 'All Channel Events',
    category: 'Server',
  },
  channel_create: {
    label: 'Channel Created',
    category: 'Server',
    fallbackKey: 'channel',
  },
  channel_delete: {
    label: 'Channel Deleted',
    category: 'Server',
    fallbackKey: 'channel',
  },
  channel_update: {
    label: 'Channel Updated',
    category: 'Server',
    fallbackKey: 'channel',
  },

  role: {
    label: 'All Role Events',
    category: 'Server',
  },
  role_create: {
    label: 'Role Created',
    category: 'Server',
    fallbackKey: 'role',
  },
  role_delete: {
    label: 'Role Deleted',
    category: 'Server',
    fallbackKey: 'role',
  },
  role_update: {
    label: 'Role Updated',
    category: 'Server',
    fallbackKey: 'role',
  },

  invite: {
    label: 'All Invite Events',
    category: 'Server',
  },
  invite_create: {
    label: 'Invite Created',
    category: 'Server',
    fallbackKey: 'invite',
  },
  invite_delete: {
    label: 'Invite Deleted',
    category: 'Server',
    fallbackKey: 'invite',
  },
  invite_used: {
    label: 'Invite Used',
    category: 'Server',
    fallbackKey: 'invite',
  },

  security: {
    label: 'Security Events',
    category: 'Security',
  },
  command_error: {
    label: 'Command Errors',
    category: 'Commands',
    fallbackKey: 'command',
  },
  command: {
    label: 'Command Usage',
    category: 'Commands',
  },
  server: {
    label: 'Server Events',
    category: 'Server',
  },
  verification: {
    label: 'Verification Events',
    category: 'Verification',
  },
  voice: {
    label: 'Voice Events',
    category: 'Voice',
  },
  emoji: {
    label: 'Emoji & Sticker Events',
    category: 'Emoji',
  },
  integration: {
    label: 'Integration & Webhook Events',
    category: 'Integrations',
  },
  automod: {
    label: 'AutoMod Events',
    category: 'AutoMod',
  },
  system: {
    label: 'System Events',
    category: 'System',
  },
};

const ALL_KEYS = Object.freeze(Object.keys(LOG_KEYS));

function isValidLogKey(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(LOG_KEYS, key);
}

function getLogKeyDefinition(key) {
  return isValidLogKey(key) ? LOG_KEYS[key] : null;
}

function getLogKeyLabel(key) {
  return getLogKeyDefinition(key)?.label || String(key || '');
}

function getLogKeyCategory(key) {
  return getLogKeyDefinition(key)?.category || 'Other';
}

function getFallbackKey(key) {
  const fallback = getLogKeyDefinition(key)?.fallbackKey;
  return fallback && isValidLogKey(fallback) ? fallback : null;
}

function listCategories() {
  const set = new Set();
  for (const key of ALL_KEYS) set.add(getLogKeyCategory(key));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function listKeysForCategory(category) {
  const cat = String(category || '').trim();
  const keys = ALL_KEYS.filter(key => getLogKeyCategory(key) === cat);
  return keys.sort((a, b) => getLogKeyLabel(a).localeCompare(getLogKeyLabel(b)));
}

module.exports = {
  LOG_KEYS,
  ALL_KEYS,
  isValidLogKey,
  getLogKeyDefinition,
  getLogKeyLabel,
  getLogKeyCategory,
  getFallbackKey,
  listCategories,
  listKeysForCategory,
};
