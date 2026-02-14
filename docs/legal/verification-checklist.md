# Discord Verification Legal Checklist

1. Replace placeholders in:
- `docs/legal/terms-of-service.md`
- `docs/legal/privacy-policy.md`

2. Fill in these fields before publishing:
- Legal operator name
- Support email
- Governing jurisdiction

3. Host these documents at public HTTPS URLs.
Example GitHub Pages format:
- `https://<github-username>.github.io/<repo-name>/terms/`
- `https://<github-username>.github.io/<repo-name>/privacy/`

4. Set environment variables so the bot can display legal links:
- `TERMS_OF_SERVICE_URL=https://your-domain.example/terms`
- `PRIVACY_POLICY_URL=https://your-domain.example/privacy`
- `SUPPORT_SERVER_URL=https://discord.gg/your-invite`

5. In Discord Developer Portal, set:
- Terms of Service URL
- Privacy Policy URL

6. Confirm users can access legal links in Discord with `/botinfo`.
