const { Events, PermissionsBitField } = require('discord.js');
const mediaOnlyStore = require('../utils/mediaOnlyStore');

const MEDIA_URL_REGEX = /\bhttps?:\/\/\S+\.(png|jpe?g|gif|webp|mp4|mov|webm|mkv)(\?\S*)?$/i;

function embedHasMedia(embed) {
  if (!embed) return false;
  if (embed.type === 'image' || embed.type === 'video' || embed.type === 'gifv') return true;
  if (embed.image?.url) return true;
  if (embed.thumbnail?.url) return true;
  if (embed.video?.url) return true;
  return false;
}

function contentIsMediaLink(content) {
  if (!content) return false;
  const tokens = content.trim().split(/\s+/);
  if (!tokens.length) return false;
  return tokens.every(token => MEDIA_URL_REGEX.test(token));
}

function messageHasMedia(message) {
  if (message.attachments?.size) return true;
  if (message.stickers?.size) return true;
  if (Array.isArray(message.embeds) && message.embeds.some(embedHasMedia)) return true;
  return contentIsMediaLink(message.content);
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (!message?.guild) return;
      if (message.author?.bot) return;

      const guildId = message.guild.id;
      if (!mediaOnlyStore.isChannelMediaOnly(guildId, message.channelId)) return;
      if (messageHasMedia(message)) return;

      const me = message.guild.members.me;
      if (!me?.permissions?.has(PermissionsBitField.Flags.ManageMessages)) return;

      await message.delete({ reason: 'Media-only channel: non-media message' });
    } catch (err) {
      console.error('Media-only enforcement failed:', err);
    }
  },
};
