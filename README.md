### Smite - Utility bot with tons of detailed logs.



1. Clone this repository or download the files
2. Install Node.js 22+ (LTS recommended)
3. Install dependencies:
   ```bash
   npm install
   ```

4. Create a `.env` file based on `.env.example`:
   ```env
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_client_id_here
   # Comma-separated guild IDs for instant dev testing (optional)
   GUILD_IDS=your_guild_id_for_testing
   # Or set GUILD_ID=your_guild_id_for_testing for a single guild
   NODE_ENV=production
   # BOT_OWNER_IDS=123456789012345678 234567890123456789
   # BOT_OWNER_ID=123456789012345678
   ```

5. Start the bot:
   ```bash
   npm start
   ```
   *This command now refreshes your slash commands before booting the bot, so you don’t need to run `deploy-commands.js` separately most of the time.*
   > **Note:** Global command deployments can take up to an hour to reach all servers. If you want to target specific guilds while testing, set `NODE_ENV=development` and provide `GUILD_IDS` (or `GUILD_ID`) before running `npm start` (or `node deploy-commands.js` for a one-off deploy).

### 4. Development Mode
Global commands are cached by Discord and may not appear for up to an hour.
For immediate command availability in specific guilds:
1. Set `NODE_ENV=development` in your `.env`
2. Add your test server IDs to `GUILD_IDS` (comma-separated), or use `GUILD_ID` for a single server
3. Run `node deploy-commands.js`


## 📄 License

This project is licensed under the MIT License.

---

**Need Help?** Use `/help` in Discord or check the troubleshooting section below.

### Troubleshooting

**Commands not appearing?**
- Make sure you ran `node deploy-commands.js`
- Check that your bot has the required permissions
- Global commands can take up to 1 hour to appear

**Bot not responding?**
- Verify your bot token is correct
- Ensure the bot is online (check Discord)
- Check console for error messages

**Permission errors?**
- Verify bot has `Send Messages` and `Use Slash Commands` permissions
- Make sure the bot role is above any role restrictions

### Environment Variables

- `GUILD_IDS`: Comma-separated list of guild IDs for instant dev testing.
- `GUILD_ID`: Single guild ID for testing if only one guild is needed.
- `OWNER_FALLBACK_ON_CHANNEL_FAIL`: When set to `true`, if a guild’s log delivery mode is set to `channel` and sending to the configured channel fails (missing/not set/inaccessible), the bot will fall back to DMing bot owners. When unset or `false`, no owner-DM fallback occurs in `channel` mode. Applies to both moderation and security logs.
- `BOT_OWNER_IDS`: Space or comma separated list of bot owner user IDs. Takes precedence over `BOT_OWNER_ID` when both are set.
- `BOT_OWNER_ID`: Single fallback bot owner user ID used when `BOT_OWNER_IDS` is unset (accepts space/comma separated IDs for compatibility).
