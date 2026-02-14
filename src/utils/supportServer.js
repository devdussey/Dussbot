const DEFAULT_SUPPORT_SERVER_URL = 'https://discord.gg/d83rZnXETm';

function getSupportServerUrl() {
  const raw = String(process.env.SUPPORT_SERVER_URL || '').trim();
  return raw || DEFAULT_SUPPORT_SERVER_URL;
}

module.exports = {
  DEFAULT_SUPPORT_SERVER_URL,
  getSupportServerUrl,
};
