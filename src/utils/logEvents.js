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
  member_boost: {
    label: 'Member Boosted',
    category: 'Member',
    fallbackKey: 'member',
  },

  bot: {
    label: 'All Bot Events',
    category: 'Bots',
  },
  bot_action: {
    label: 'Bot Action',
    category: 'Bots',
    fallbackKey: 'bot',
  },
  bot_join: {
    label: 'Bot Joined',
    category: 'Bots',
    fallbackKey: 'bot',
  },
  bot_leave: {
    label: 'Bot Left',
    category: 'Bots',
    fallbackKey: 'bot',
  },
  bot_message_create: {
    label: 'Bot Message Created',
    category: 'Bots',
    fallbackKey: 'bot_action',
  },
  bot_message_delete: {
    label: 'Bot Message Deleted',
    category: 'Bots',
    fallbackKey: 'bot_action',
  },
  bot_message_edit: {
    label: 'Bot Message Edited',
    category: 'Bots',
    fallbackKey: 'bot_action',
  },
  bot_moderation: {
    label: 'Bot Moderation',
    category: 'Bots',
    fallbackKey: 'bot_action',
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
    label: 'User Muted',
    category: 'Moderation',
    fallbackKey: 'moderation',
  },
  member_untimeout: {
    label: 'User Unmuted',
    category: 'Moderation',
    fallbackKey: 'moderation',
  },
  messages_purged: {
    label: 'Messages Purged',
    category: 'Message',
    fallbackKey: 'message',
  },
  restraining_order_violation: {
    label: 'Restraining Order Violation',
    category: 'Security',
    fallbackKey: 'security',
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
  category_create: {
    label: 'Category Created',
    category: 'Server',
    fallbackKey: 'channel',
  },
  category_delete: {
    label: 'Category Deleted',
    category: 'Server',
    fallbackKey: 'channel',
  },
  category_update: {
    label: 'Category Updated',
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
  antinuke_enabled: {
    label: 'Anti-Nuke Enabled',
    category: 'Security',
    fallbackKey: 'security',
  },
  antinuke_disabled: {
    label: 'Anti-Nuke Disabled',
    category: 'Security',
    fallbackKey: 'security',
  },
  antinuke_edited: {
    label: 'Anti-Nuke Edited',
    category: 'Security',
    fallbackKey: 'security',
  },
  antinuke_triggered: {
    label: 'Anti-Nuke Triggered',
    category: 'Security',
    fallbackKey: 'security',
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
    label: 'Server Settings Changed',
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
  emoji_sticker_add: {
    label: 'Emoji/Sticker Added',
    category: 'Emoji',
    fallbackKey: 'emoji',
  },
  emoji_sticker_delete: {
    label: 'Emoji/Sticker Deleted',
    category: 'Emoji',
    fallbackKey: 'emoji',
  },
  emoji_sticker_edit: {
    label: 'Emoji/Sticker Edited',
    category: 'Emoji',
    fallbackKey: 'emoji',
  },
  integration: {
    label: 'Integration & Webhook Events',
    category: 'Integrations',
  },
  webhook_create: {
    label: 'Webhook Created',
    category: 'Integrations',
    fallbackKey: 'integration',
  },
  webhook_delete: {
    label: 'Webhook Deleted',
    category: 'Integrations',
    fallbackKey: 'integration',
  },
  automod: {
    label: 'AutoMod Events',
    category: 'AutoMod',
  },
  system: {
    label: 'System Events',
    category: 'System',
  },
  economy: {
    label: 'All Economy Events',
    category: 'Economy',
  },
  rupee_earned: {
    label: 'Rupees Earned',
    category: 'Economy',
    fallbackKey: 'economy',
  },
  rupee_given: {
    label: 'Rupees Given',
    category: 'Economy',
    fallbackKey: 'economy',
  },
  rupee_spend: {
    label: 'Rupees Spent',
    category: 'Economy',
    fallbackKey: 'economy',
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
