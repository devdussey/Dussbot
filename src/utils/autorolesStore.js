const fs = require('fs');
const { ensureFileSync, resolveDataPath, writeJsonSync } = require('./dataDir');

const STORE_FILE = 'autoroles.json';
const TARGET_KEYS = ['all', 'member', 'bot'];

function getDataFile() {
    return resolveDataPath(STORE_FILE);
}

let cache = null;

function ensureLoaded() {
    if (!cache) {
        try {
            ensureFileSync(STORE_FILE, '{}');
            const raw = fs.readFileSync(getDataFile(), 'utf8');
            cache = raw ? JSON.parse(raw) : {};
            if (!cache || typeof cache !== 'object') cache = {};
        } catch (e) {
            console.error('Failed to load autoroles store:', e);
            cache = {};
        }
    }
}

function save() {
    const safe = cache && typeof cache === 'object' ? cache : {};
    writeJsonSync(STORE_FILE, safe);
}

function ensureGuildEntry(guildId) {
    ensureLoaded();
    let entry = cache[guildId];
    let needsSave = false;

    if (Array.isArray(entry)) {
        entry = { all: Array.from(new Set(entry)), member: [], bot: [] };
        cache[guildId] = entry;
        needsSave = true;
    } else if (!entry || typeof entry !== 'object') {
        entry = { all: [], member: [], bot: [] };
        cache[guildId] = entry;
        needsSave = true;
    } else {
        for (const key of TARGET_KEYS) {
            if (!Array.isArray(entry[key])) {
                entry[key] = [];
                needsSave = true;
            }
        }
    }

    if (needsSave) save();
    return entry;
}

function getGuildRoles(guildId, target = 'all') {
    const entry = ensureGuildEntry(guildId);
    const list = entry[target];
    return Array.isArray(list) ? [...new Set(list)] : [];
}

function getEffectiveRoles(guildId, targetType) {
    const entry = ensureGuildEntry(guildId);
    const combined = new Set(entry.all || []);
    if (targetType === 'member' || targetType === 'bot') {
        for (const id of entry[targetType] || []) {
            combined.add(id);
        }
    }
    return Array.from(combined);
}

function setGuildRoles(guildId, roleIds, target = 'all') {
    const entry = ensureGuildEntry(guildId);
    const unique = Array.from(new Set(roleIds));
    entry[target] = unique;
    save();
}

function addGuildRole(guildId, roleId, target = 'all') {
    const entry = ensureGuildEntry(guildId);
    const list = entry[target];
    if (!list.includes(roleId)) {
        list.push(roleId);
        save();
        return true;
    }
    return false;
}

function removeGuildRole(guildId, roleId, target = 'all') {
    const entry = ensureGuildEntry(guildId);
    const list = entry[target];
    const filtered = list.filter(id => id !== roleId);
    if (filtered.length !== list.length) {
        entry[target] = filtered;
        save();
        return true;
    }
    return false;
}

function clearGuildRoles(guildId, target) {
    const entry = ensureGuildEntry(guildId);
    if (target && TARGET_KEYS.includes(target)) {
        entry[target] = [];
    } else {
        for (const key of TARGET_KEYS) {
            entry[key] = [];
        }
    }
    save();
}

module.exports = {
    getGuildRoles,
    getEffectiveRoles,
    setGuildRoles,
    addGuildRole,
    removeGuildRole,
    clearGuildRoles,
};
