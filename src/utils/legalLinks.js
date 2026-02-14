function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

function getTermsOfServiceUrl() {
  return normalizeUrl(process.env.TERMS_OF_SERVICE_URL);
}

function getPrivacyPolicyUrl() {
  return normalizeUrl(process.env.PRIVACY_POLICY_URL);
}

function getLegalLinks() {
  return {
    termsOfServiceUrl: getTermsOfServiceUrl(),
    privacyPolicyUrl: getPrivacyPolicyUrl(),
  };
}

module.exports = {
  getTermsOfServiceUrl,
  getPrivacyPolicyUrl,
  getLegalLinks,
};
