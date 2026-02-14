const test = require('node:test');
const assert = require('node:assert/strict');

function createBaseInteraction({ subcommand, stringOptions = {}, attachmentOptions = {}, guild }) {
  const state = {
    deferred: false,
    replyPayload: null,
    editPayload: null,
  };

  return {
    interaction: {
      inGuild() {
        return true;
      },
      guild,
      member: {
        permissions: {
          has() {
            return true;
          },
        },
      },
      options: {
        getSubcommand() {
          return subcommand;
        },
        getString(name) {
          return Object.prototype.hasOwnProperty.call(stringOptions, name) ? stringOptions[name] : null;
        },
        getAttachment(name) {
          return Object.prototype.hasOwnProperty.call(attachmentOptions, name) ? attachmentOptions[name] : null;
        },
      },
      async reply(payload) {
        state.replyPayload = payload;
        return payload;
      },
      async deferReply() {
        state.deferred = true;
      },
      async editReply(payload) {
        state.editPayload = payload;
        return payload;
      },
    },
    state,
  };
}

test('sticker add resolves attachment proxy URL and sends discord.js-compatible file payload', async () => {
  const stickerPath = require.resolve('../src/commands/sticker');
  const originalFetch = globalThis.fetch;
  const fetchUrls = [];

  globalThis.fetch = async (url) => {
    fetchUrls.push(url);
    return {
      ok: true,
      status: 200,
      headers: {
        get(header) {
          return String(header).toLowerCase() === 'content-type' ? 'application/json' : null;
        },
      },
      async arrayBuffer() {
        return Buffer.from('{}');
      },
    };
  };

  delete require.cache[stickerPath];
  const sticker = require('../src/commands/sticker');

  const createdPayloads = [];
  const { interaction, state } = createBaseInteraction({
    subcommand: 'add',
    stringOptions: {
      name: 'Sample Sticker',
      url: null,
      tags: null,
      description: null,
    },
    attachmentOptions: {
      file: {
        url: null,
        proxyURL: 'https://cdn.discordapp.com/attachments/1/2/source.png',
        name: 'source.png',
        contentType: 'image/png',
        size: 128,
      },
    },
    guild: {
      members: {
        me: {
          permissions: {
            has() {
              return true;
            },
          },
        },
      },
      stickers: {
        async create(payload) {
          createdPayloads.push(payload);
          return { id: '555', name: payload.name };
        },
      },
    },
  });

  try {
    await sticker.execute(interaction);
  } finally {
    globalThis.fetch = originalFetch;
    delete require.cache[stickerPath];
  }

  assert.equal(state.replyPayload, null);
  assert.equal(state.deferred, true);
  assert.equal(createdPayloads.length, 1);
  assert.deepEqual(fetchUrls, ['https://cdn.discordapp.com/attachments/1/2/source.png']);

  const payload = createdPayloads[0];
  assert.equal(payload.name, 'sample_sticker');
  assert.ok(Buffer.isBuffer(payload.file.attachment));
  assert.equal(payload.file.data, undefined);
  assert.match(state.editPayload.content, /Added sticker "sample_sticker"/);
});

test('emoji add accepts attachment proxy URL input', async () => {
  const emoji = require('../src/commands/emoji');
  const createCalls = [];

  const { interaction, state } = createBaseInteraction({
    subcommand: 'add',
    stringOptions: {
      name: 'Party Time',
      url: null,
    },
    attachmentOptions: {
      file: {
        url: null,
        proxyURL: 'https://cdn.discordapp.com/attachments/1/2/party.png',
      },
    },
    guild: {
      members: {
        me: {
          permissions: {
            has() {
              return true;
            },
          },
        },
      },
      emojis: {
        async create(payload) {
          createCalls.push(payload);
          return { id: '777', name: payload.name, animated: false };
        },
      },
    },
  });

  await emoji.execute(interaction);

  assert.equal(state.replyPayload, null);
  assert.equal(state.deferred, true);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].attachment, 'https://cdn.discordapp.com/attachments/1/2/party.png');
  assert.equal(createCalls[0].name, 'party_time');
  assert.match(state.editPayload.content, /Added emoji <:party_time:777>/);
});
