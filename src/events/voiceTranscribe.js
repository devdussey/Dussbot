const { Events, MessageFlags } = require('discord.js');
const { transcribeAttachment, MAX_BYTES } = require('../utils/whisper');
const voiceAutoStore = require('../utils/voiceAutoStore');
const { createFieldEmbeds } = require('../utils/embedFields');
const { translate } = require('@vitalets/google-translate-api');

const HAS_OPENAI_KEY = Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_API);
const LANGUAGE_DISPLAY = (() => {
  try {
    if (typeof Intl.DisplayNames === 'function') {
      return new Intl.DisplayNames(['en'], { type: 'language' });
    }
  } catch (_) {}
  return null;
})();

function formatLanguageName(code) {
  if (!code) return null;
  const normalized = String(code).toLowerCase();
  const fromDisplay = LANGUAGE_DISPLAY?.of(normalized);
  if (fromDisplay) return fromDisplay;
  return normalized;
}

async function detectTranslation(text) {
  if (!text) return null;
  try {
    const result = await translate(text, { to: 'en' });
    const iso = String(result?.from?.language?.iso || '').toLowerCase();
    if (!iso || iso === 'en') return null;
    const translation = String(result?.text || '').trim();
    if (!translation) return null;
    const name = formatLanguageName(iso);
    return { iso, name, translation };
  } catch (err) {
    console.error('Voice translation failed:', err);
    return null;
  }
}

function renderContentSection(text, translationDetails) {
  const lines = [String(text || '').trim() || '(No content)'];
  if (translationDetails) {
    const languageLabel = translationDetails.name || translationDetails.iso || 'Unknown language';
    lines.push('');
    lines.push(`Language detected: ${languageLabel}`);
    lines.push(`English translation: ${translationDetails.translation}`);
  }
  return lines.join('\n');
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (!message.guild) return;
      if (message.author?.bot) return;
      if (!message.flags?.has(MessageFlags.IsVoiceMessage)) return;

      if (!HAS_OPENAI_KEY) return;

      if (!message.channelId) return;
      const enabled = await voiceAutoStore.isChannelEnabled(message.guildId, message.channelId);
      if (!enabled) return;

      const attachment = message.attachments.first();
      if (!attachment) return;

      if (typeof attachment.size === 'number' && attachment.size > MAX_BYTES) {
        try { await message.reply(`Voice message is too large to transcribe (max ${MAX_BYTES / (1024*1024)}MB).`); } catch (_) {}
        return;
      }

      const text = await transcribeAttachment(attachment);
      const translationDetails = await detectTranslation(text);
      const embeds = createFieldEmbeds({
        guildId: message.guildId,
        title: 'Voice Transcript',
        user: message.author,
        sections: [
          { name: 'Content', value: renderContentSection(text, translationDetails) }
        ]
      });

      if (!embeds.length) {
        try { await message.reply('Transcript was empty.'); } catch (_) {}
        return;
      }

      try {
        await message.reply({ embeds: [embeds[0]] });
      } catch (_) {}

      if (embeds.length > 1) {
        for (let i = 1; i < embeds.length; i += 1) {
          try { await message.channel.send({ embeds: [embeds[i]] }); } catch (_) {}
        }
      }
    } catch (err) {
      try {
        await message.reply('Sorry, I could not transcribe that voice message.');
      } catch (_) {}
      console.error('Voice transcription failed:', err);
    }
  }
};
