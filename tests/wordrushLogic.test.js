const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pickLetters,
  normaliseCandidateWord,
  containsLettersInOrder,
} = require('../src/utils/wordRushLogic');

test('pickLetters returns uppercase letters', () => {
  const letters = pickLetters(3);
  assert.equal(Array.isArray(letters), true);
  assert.equal(letters.length, 3);
  for (const letter of letters) {
    assert.match(letter, /^[A-Z]$/);
  }
});

test('normaliseCandidateWord accepts names/words and rejects non-words', () => {
  assert.equal(normaliseCandidateWord('Alphabet'), 'Alphabet');
  assert.equal(normaliseCandidateWord("O'Connor"), "O'Connor");
  assert.equal(normaliseCandidateWord('Jean-Luc'), 'Jean-Luc');
  assert.equal(normaliseCandidateWord('  Alphabet!!!  '), 'Alphabet');

  assert.equal(normaliseCandidateWord('ab'), null);
  assert.equal(normaliseCandidateWord('123'), null);
  assert.equal(normaliseCandidateWord('hello world'), null);
});

test('containsLettersInOrder enforces ordered sequence', () => {
  assert.equal(containsLettersInOrder('alphabet', ['A', 'B', 'T']), true); // A l p h a b e t
  assert.equal(containsLettersInOrder('abate', ['A', 'B', 'T']), true);
  assert.equal(containsLettersInOrder('table', ['A', 'B', 'T']), false);
  assert.equal(containsLettersInOrder('tabet', ['A', 'B', 'T']), true);
  assert.equal(containsLettersInOrder('a-b--t', ['A', 'B', 'T']), true);
});
