const LETTER_POOL = 'EEEEEEEEEEEEAAAAAAAAAIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGGBBCCMMPPFFHHVVWWYYKJXQZ';

function pickLetters(count = 3) {
  const target = Number.isInteger(count) ? count : 3;
  const letters = [];
  for (let i = 0; i < target; i += 1) {
    const idx = Math.floor(Math.random() * LETTER_POOL.length);
    letters.push(LETTER_POOL[idx]);
  }
  return letters;
}

function formatLetters(letters) {
  if (!Array.isArray(letters) || !letters.length) return '';
  return letters.map(letter => String(letter || '').toUpperCase()).join(' ');
}

function normaliseCandidateWord(input) {
  if (!input || typeof input !== 'string') return null;
  let trimmed = input.trim();
  if (!trimmed) return null;

  // Common cleanup for Discord chat: strip wrapping punctuation and normalise apostrophes/dashes.
  trimmed = trimmed.replace(/[’]/g, "'").replace(/[–—]/g, '-');
  trimmed = trimmed.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z'\\-]+$/, '');
  if (!trimmed) return null;

  // Allow proper names as well as words (letters + optional apostrophes/hyphens).
  if (!/^[A-Za-z][A-Za-z'\\-]{2,31}$/.test(trimmed)) return null;
  return trimmed;
}

function containsLettersInOrder(word, letters) {
  if (!word || typeof word !== 'string') return false;
  const required = Array.isArray(letters)
    ? letters.map(letter => String(letter || '').toUpperCase()).filter(Boolean)
    : String(letters || '').toUpperCase().split('').filter(Boolean);

  if (required.length !== 3) return false;

  const haystack = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (haystack.length < required.length) return false;

  let idx = -1;
  for (const letter of required) {
    idx = haystack.indexOf(letter, idx + 1);
    if (idx === -1) return false;
  }
  return true;
}

module.exports = {
  pickLetters,
  formatLetters,
  normaliseCandidateWord,
  containsLettersInOrder,
};

