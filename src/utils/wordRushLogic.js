const LETTER_POOL = 'EEEEEEEEEEEEAAAAAAAAAIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGGBBCCMMPPFFHHVVWWYYKJXQZ';

// A small built-in set of seed words/names so the described triplet is always derivable from at least one real word.
// (We don't dictionary-check answers, but this ensures prompts are realistically solvable.)
const SEED_WORDS = [
  'alphabet',
  'adventure',
  'afterparty',
  'amsterdam',
  'anthology',
  'apartment',
  'astronaut',
  'attention',
  'beautiful',
  'beginning',
  'birmingham',
  'blackbird',
  'butterfly',
  'california',
  'celebration',
  'chocolate',
  'christopher',
  'community',
  'computer',
  'connection',
  'construction',
  'conversation',
  'dangerous',
  'direction',
  'elephant',
  'entertainment',
  'experience',
  'fantastic',
  'fireworks',
  'foundation',
  'friendship',
  'generation',
  'happiness',
  'important',
  'information',
  'instrument',
  'international',
  'jennifer',
  'jeremiah',
  'jonathan',
  'katherine',
  'louisiana',
  'management',
  'marvellous',
  'melancholy',
  'microphone',
  'mountains',
  'newcastle',
  'notorious',
  'october',
  'orchestra',
  'parliament',
  'pineapple',
  'president',
  'progress',
  'revolution',
  'sandwich',
  'september',
  'signature',
  'something',
  'sometimes',
  'strawberry',
  'submarine',
  'technology',
  'television',
  'tournament',
  'university',
  'wonderful',
  'yesterday',
];

// Backup triplets if the seed word list is ever emptied.
const PLAYABLE_TRIPLETS = [
  'THE', 'AND', 'ING', 'ION', 'ENT', 'TIO', 'ATI', 'ERE', 'HER', 'HIS', 'THA', 'THI', 'NTH', 'YOU', 'ARE', 'FOR', 'NOT',
  'ONE', 'OUR', 'OUT', 'ALL', 'EAS', 'EST', 'RES', 'TER', 'VER', 'CON', 'PRO', 'STA', 'MEN', 'EVE', 'OVE', 'EAL', 'EAR',
  'EER', 'ERS', 'NES', 'NCE', 'SIO', 'SIN', 'TED', 'TES', 'PRE', 'PER', 'SUP', 'SUB', 'TRA', 'STR', 'GRA', 'GRO', 'GLO',
  'WOR', 'ORD', 'RUS', 'USH', 'ASH', 'SHE', 'HEA', 'ART', 'HOU', 'USE', 'HOM', 'OME', 'FAM', 'MIL', 'ILI', 'LIA', 'IAL',
  'BLE', 'ABL', 'FUL', 'OUS', 'IVE', 'IZE', 'ISE',
  'CAT', 'DOG', 'MAN', 'KID', 'CAR', 'BUS', 'AIR', 'SEA', 'SKY', 'SUN',
  'ANA', 'ANN', 'SAM', 'BEN', 'MAX', 'MIA', 'EVA', 'AVA', 'NOA', 'LEO', 'KAI', 'ZOE', 'JAN', 'KIM', 'ALI',
].filter(item => /^[A-Z]{3}$/.test(item));

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

function pickPlayableLetters() {
  if (SEED_WORDS.length) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const seed = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
      const clean = String(seed || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (clean.length < 3) continue;

      const i = Math.floor(Math.random() * (clean.length - 2));
      const j = i + 1 + Math.floor(Math.random() * (clean.length - i - 1));
      const k = j + 1 + Math.floor(Math.random() * (clean.length - j - 1));
      return [clean[i], clean[j], clean[k]];
    }
  }

  if (PLAYABLE_TRIPLETS.length) {
    const triplet = PLAYABLE_TRIPLETS[Math.floor(Math.random() * PLAYABLE_TRIPLETS.length)];
    return triplet.split('');
  }

  return pickLetters(3);
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
  pickPlayableLetters,
  formatLetters,
  normaliseCandidateWord,
  containsLettersInOrder,
};
