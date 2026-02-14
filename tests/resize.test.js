const test = require('node:test');
const assert = require('node:assert/strict');

const resize = require('../src/commands/resize');

function createInteraction({ attachment = null, url = null, percentage = null, pixels = null } = {}) {
  let deferred = false;
  let reply = null;
  return {
    options: {
      getAttachment(name) {
        if (name === 'image') return attachment;
        return null;
      },
      getString(name) {
        if (name === 'url') return url;
        if (name === 'percentage') return percentage;
        if (name === 'pixels') return pixels;
        return null;
      },
    },
    async deferReply() {
      deferred = true;
    },
    async editReply(payload) {
      reply = payload;
      return payload;
    },
    getState() {
      return { deferred, reply };
    },
  };
}

test('resize command is configured as a third-party app command', () => {
  const json = resize.data.toJSON();
  assert.equal(json.name, 'resize');
  assert.deepEqual(json.integration_types, [0, 1]);
  assert.deepEqual(json.contexts, [0, 1, 2]);
});

test('resize rejects using percentage and pixels together', async () => {
  const interaction = createInteraction({
    attachment: {
      url: 'https://cdn.example.com/image.png',
      contentType: 'image/png',
      name: 'image.png',
    },
    percentage: '50',
    pixels: '64x64',
  });

  await resize.execute(interaction);
  const state = interaction.getState();
  assert.equal(state.deferred, true);
  assert.equal(state.reply, 'Choose either `percentage` or `pixels`, not both.');
});
