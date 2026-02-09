const fs = require('fs');
const { ensureFileSync, writeJson, resolveDataPath } = require('./dataDir');
const { extractWords } = require('./wordStatsParser');

const STORE_FILE_NAME = 'word_stats.json';
const MAX_WORD_LEADERBOARD = 50;
const MAX_USER_LEADERBOARD = 25;
const MAX_TOP_USERS_PER_WORD = 3;

let cache = null;

function ensureStoreFile() {
    try {
        ensureFileSync(STORE_FILE_NAME, { guilds: {} });
    } catch (err) {
        console.error('Failed to initialise word stats store', err);
    }
}

function loadStore() {
    if (cache) return cache;
    ensureStoreFile();
    try {
        const raw = fs.readFileSync(resolveDataPath(STORE_FILE_NAME), 'utf8');
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') {
            cache = { guilds: {} };
        } else {
            if (!parsed.guilds || typeof parsed.guilds !== 'object') parsed.guilds = {};
            cache = parsed;
        }
    } catch (err) {
        cache = { guilds: {} };
    }
    return cache;
}

async function saveStore() {
    ensureStoreFile();
    const safe = cache && typeof cache === 'object' ? cache : { guilds: {} };
    await writeJson(STORE_FILE_NAME, safe);
}

function ensureGuildData(guildId) {
    if (!guildId) return null;
    const store = loadStore();
    if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
        store.guilds[guildId] = {
            summary: { totalWords: 0, totalMessages: 0, uniqueWords: 0 },
            users: {},
            words: {},
        };
    }
    const guild = store.guilds[guildId];
    if (!guild.summary || typeof guild.summary !== 'object') {
        guild.summary = { totalWords: 0, totalMessages: 0, uniqueWords: 0 };
    }
    if (!guild.users || typeof guild.users !== 'object') {
        guild.users = {};
    }
    if (!guild.words || typeof guild.words !== 'object') {
        guild.words = {};
    }
    if (!Number.isFinite(guild.summary.totalWords)) guild.summary.totalWords = 0;
    if (!Number.isFinite(guild.summary.totalMessages)) guild.summary.totalMessages = 0;
    if (!Number.isFinite(guild.summary.uniqueWords)) guild.summary.uniqueWords = 0;
    return guild;
}

function ensureUserRecord(guild, userId) {
    if (!guild || !userId) return null;
    if (!guild.users[userId] || typeof guild.users[userId] !== 'object') {
        guild.users[userId] = { messageCount: 0, wordCount: 0, lastKnownTag: null };
    }
    const record = guild.users[userId];
    if (!Number.isFinite(record.messageCount)) record.messageCount = 0;
    if (!Number.isFinite(record.wordCount)) record.wordCount = 0;
    if (record.lastKnownTag === undefined) record.lastKnownTag = null;
    return record;
}

function ensureWordEntry(guild, word) {
    if (!guild || !word) return null;
    if (!guild.words[word] || typeof guild.words[word] !== 'object') {
        guild.words[word] = { count: 0, perUser: {} };
    }
    const entry = guild.words[word];
    if (!Number.isFinite(entry.count)) entry.count = 0;
    if (!entry.perUser || typeof entry.perUser !== 'object') entry.perUser = {};
    return entry;
}

function ensureWordUserEntry(wordEntry, userId) {
    if (!wordEntry || !userId) return null;
    if (!wordEntry.perUser[userId] || typeof wordEntry.perUser[userId] !== 'object') {
        wordEntry.perUser[userId] = { count: 0, lastKnownTag: null };
    }
    const record = wordEntry.perUser[userId];
    if (!Number.isFinite(record.count)) record.count = 0;
    if (record.lastKnownTag === undefined) record.lastKnownTag = null;
    return record;
}

function normalizeTag(tag) {
    if (!tag) return null;
    const text = String(tag).trim();
    if (!text) return null;
    return text.slice(0, 100);
}

async function recordMessage(guildId, userId, userTag, content, options = {}) {
    if (!guildId || !userId) return null;
    const guild = ensureGuildData(guildId);
    if (!guild) return null;
    const words = Array.isArray(options.words) ? options.words : extractWords(content, options);
    const userEntry = ensureUserRecord(guild, userId);
    const normalizedTag = normalizeTag(userTag);
    userEntry.messageCount += 1;
    if (normalizedTag) {
        userEntry.lastKnownTag = normalizedTag;
    }
    let processedWords = 0;
    if (words.length) {
        userEntry.wordCount += words.length;
        guild.summary.totalWords += words.length;
        for (const word of words) {
            const entry = ensureWordEntry(guild, word);
            const wasNew = entry.count <= 0;
            entry.count += 1;
            if (wasNew) guild.summary.uniqueWords += 1;
            const wordUser = ensureWordUserEntry(entry, userId);
            wordUser.count += 1;
            if (normalizedTag) wordUser.lastKnownTag = normalizedTag;
            processedWords += 1;
        }
    }
    guild.summary.totalMessages += 1;
    await saveStore();
    return {
        processedWords,
        messageCount: userEntry.messageCount,
        wordCount: userEntry.wordCount,
    };
}

function getGuildSummary(guildId) {
    const store = loadStore();
    const guild = store.guilds?.[guildId];
    if (!guild) return { totalWords: 0, uniqueWords: 0, totalMessages: 0 };
    const words = guild.words || {};
    const summary = guild.summary || { totalWords: 0, totalMessages: 0, uniqueWords: 0 };
    const totalWords = Number.isFinite(summary.totalWords) ? Math.floor(summary.totalWords) : 0;
    const totalMessages = Number.isFinite(summary.totalMessages) ? Math.floor(summary.totalMessages) : 0;
    const uniqueWords = Object.keys(words).length;
    return { totalWords, uniqueWords, totalMessages };
}

function getWordTopContributors(perUser, limit) {
    if (!perUser || typeof perUser !== 'object') return [];
    const entries = Object.entries(perUser)
        .map(([userId, record]) => ({
            userId,
            count: Number.isFinite(record?.count) ? Math.floor(record.count) : 0,
            lastKnownTag: record?.lastKnownTag || null,
        }))
        .filter(entry => entry.count > 0)
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.userId.localeCompare(b.userId);
        })
        .slice(0, Math.max(1, Math.min(limit || 1, MAX_TOP_USERS_PER_WORD)));
    return entries;
}

function getWordLeaderboard(guildId, options = {}) {
    const limitRaw = Number.isFinite(options.limit) ? Math.trunc(options.limit) : 20;
    const limit = Math.max(1, Math.min(limitRaw, MAX_WORD_LEADERBOARD));
    const store = loadStore();
    const guild = store.guilds?.[guildId];
    const summary = getGuildSummary(guildId);
    if (!guild || !guild.words) {
        return { entries: [], totalWords: summary.totalWords, uniqueWords: summary.uniqueWords, limit };
    }
    const entries = Object.entries(guild.words)
        .map(([word, record]) => ({
            word,
            count: Number.isFinite(record?.count) ? Math.floor(record.count) : 0,
            topUsers: getWordTopContributors(record?.perUser, options.topUsers || 1),
        }))
        .filter(entry => entry.count > 0)
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.word.localeCompare(b.word);
        })
        .slice(0, limit);
    return { entries, totalWords: summary.totalWords, uniqueWords: summary.uniqueWords, limit };
}

function getUserLeaderboard(guildId, options = {}) {
    const limitRaw = Number.isFinite(options.limit) ? Math.trunc(options.limit) : 10;
    const limit = Math.max(1, Math.min(limitRaw, MAX_USER_LEADERBOARD));
    const metric = options.metric === 'messages' ? 'messageCount' : 'wordCount';
    const store = loadStore();
    const guild = store.guilds?.[guildId];
    const summary = getGuildSummary(guildId);
    if (!guild || !guild.users) {
        return { entries: [], totalMessages: summary.totalMessages, limit };
    }
    const entries = Object.entries(guild.users)
        .map(([userId, record]) => ({
            userId,
            wordCount: Number.isFinite(record?.wordCount) ? Math.floor(record.wordCount) : 0,
            messageCount: Number.isFinite(record?.messageCount) ? Math.floor(record.messageCount) : 0,
            lastKnownTag: record?.lastKnownTag || null,
        }))
        .filter(entry => entry.wordCount > 0 || entry.messageCount > 0)
        .sort((a, b) => {
            if (b[metric] !== a[metric]) return b[metric] - a[metric];
            return a.userId.localeCompare(b.userId);
        })
        .slice(0, limit);
    return { entries, totalMessages: summary.totalMessages, limit };
}

module.exports = {
    recordMessage,
    getWordLeaderboard,
    getUserLeaderboard,
    getGuildSummary,
    MAX_WORD_LEADERBOARD,
    MAX_USER_LEADERBOARD,
};
