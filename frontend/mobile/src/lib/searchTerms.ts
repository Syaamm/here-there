/**
 * Search that understands words, not just letters: what a person types is split into words, each word is also read as the other
 * words that mean the same (in English and Italian: "aperitivo" is also "happy hour", "drinks", "spritz"; "giappone" is also "Japan"),
 * and a small typo is forgiven ("aprevito" still means "aperitivo"). A result has to match every word the person typed.
 *
 * This file is kept identical on both sides (the API: backend/api/src/common/search-terms.ts, the app: frontend/mobile/src/lib/searchTerms.ts).
 * When one changes, change the other.
 */

/** Words that mean the same thing, whatever the language. Lower case, no accents. A phrase of several words is fine. */
const GROUPS: string[][] = [
  // what people do
  ['aperitivo', 'aperitif', 'happy hour', 'happyhour', 'spritz', 'cocktail', 'cocktails', 'drinks', 'drink', 'birra', 'beer', 'pub', 'brindisi', 'after work', 'afterwork', 'bere'],
  ['caffe', 'coffee', 'espresso', 'cappuccino', 'cafe', 'colazione', 'breakfast', 'brunch'],
  ['cena', 'dinner', 'supper', 'ristorante', 'restaurant', 'trattoria'],
  ['pranzo', 'lunch'],
  ['cibo', 'food', 'mangiare', 'eat', 'eating', 'street food', 'degustazione', 'tasting', 'pizza', 'pasta', 'gelato', 'cucina', 'cooking'],
  ['corsa', 'correre', 'run', 'running', 'jogging', 'jog', 'runners'],
  ['calcio', 'football', 'soccer', 'calcetto', 'five-a-side', 'partita'],
  ['basket', 'basketball', 'pallacanestro'],
  ['yoga', 'pilates', 'stretching', 'meditazione', 'meditation'],
  ['palestra', 'gym', 'workout', 'fitness', 'allenamento', 'training', 'sport', 'sports'],
  ['passeggiata', 'walk', 'walking', 'camminata', 'stroll', 'hike', 'hiking', 'trekking', 'escursione'],
  ['bici', 'bicicletta', 'bike', 'biking', 'cycling', 'ciclismo'],
  ['museo', 'museum', 'mostra', 'exhibition', 'galleria', 'gallery', 'arte', 'art', 'cultura', 'culture'],
  ['musica', 'music', 'concerto', 'concert', 'live', 'jam', 'dj', 'festa', 'party', 'club', 'discoteca', 'serata', 'nightlife'],
  ['film', 'cinema', 'movie', 'movies', 'proiezione'],
  ['libro', 'libri', 'book', 'books', 'lettura', 'reading', 'book club'],
  ['gioco', 'giochi', 'game', 'games', 'board game', 'giochi da tavolo', 'trivia', 'quiz'],
  ['foto', 'fotografia', 'photo', 'photography', 'photos'],
  ['parco', 'park', 'giardino', 'garden', 'picnic'],
  ['gratis', 'free', 'gratuito'],
  ['amici', 'friends', 'friend', 'amicizia'],
  // travel
  ['viaggio', 'viaggiare', 'trip', 'travel', 'travelling', 'vacanza', 'holiday', 'vacation', 'weekend', 'gita'],
  ['spiaggia', 'beach', 'mare', 'sea', 'seaside', 'costa', 'coast'],
  ['montagna', 'mountain', 'mountains', 'monte', 'alpi', 'alps', 'dolomiti', 'dolomites'],
  ['natura', 'nature', 'outdoor', 'outdoors', 'all aperto'],
  ['avventura', 'avventure', 'adventure', 'adventures'],
  ['citta', 'city', 'cities', 'urbano'],
  // places (an Italian traveller types the Italian name, the trip says the English one, or the other way round)
  ['giappone', 'japan'], ['spagna', 'spain'], ['francia', 'france'], ['germania', 'germany'], ['grecia', 'greece'],
  ['portogallo', 'portugal'], ['tailandia', 'thailand'], ['maldive', 'maldives'], ['svizzera', 'switzerland'],
  ['inghilterra', 'england', 'regno unito', 'united kingdom', 'uk'], ['londra', 'london'], ['parigi', 'paris'],
  ['roma', 'rome'], ['milano', 'milan'], ['firenze', 'florence'], ['venezia', 'venice'], ['napoli', 'naples'],
  ['torino', 'turin'], ['siviglia', 'seville'], ['lisbona', 'lisbon'], ['praga', 'prague'], ['atene', 'athens'],
  ['messico', 'mexico'], ['stati uniti', 'united states', 'usa', 'america'], ['cina', 'china'], ['egitto', 'egypt'],
  ['turchia', 'turkey'], ['croazia', 'croatia'], ['islanda', 'iceland'], ['norvegia', 'norway'], ['svezia', 'sweden'],
  ['olanda', 'paesi bassi', 'netherlands', 'holland'], ['belgio', 'belgium'], ['sardegna', 'sardinia'], ['sicilia', 'sicily'],
  ['toscana', 'tuscany'], ['puglia', 'apulia'], ['new york', 'nyc'],
];

/** Lower case and without accents ("Caffè" and "caffe" are the same word). */
export const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words of what was typed: letters and digits, two or more of them, at most four words. */
export const searchWords = (q: string) => plain(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2).slice(0, 4);

/** Edit distance between two words (how many single-letter changes turn one into the other). */
function distance(a: string, b: string) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}
/** How many letters may differ for a word of this length to still count as the same word (short words must be exact). */
const allowed = (len: number) => (len >= 9 ? 3 : len >= 7 ? 2 : len >= 5 ? 1 : 0);

/** Whether a typed word means this member of a group: the same word, the start of it (or it the start of the typed one), or a near miss. */
function means(word: string, member: string) {
  if (word === member) return true;
  if (word.length >= 3 && member.length >= 3 && (member.startsWith(word) || word.startsWith(member))) return true;
  if (member.includes(' ')) return false;
  const len = Math.max(word.length, member.length);
  const d = distance(word, member);
  if (word.length >= 5 && member.length >= 5 && d <= allowed(len)) return true;
  // a longer word typed badly ("aprevito" for "aperitivo"): the same first letter and no more than about half of it different
  return word.length >= 7 && member.length >= 7 && word[0] === member[0] && d / len <= 0.45;
}

/** What a typed word can also be looked for as: itself and every word that means the same (never empty). */
export function expandSearchWord(word: string): string[] {
  const w = plain(word).trim();
  const out = new Set<string>([w]);
  for (const g of GROUPS) if (g.some((m) => means(w, m))) for (const m of g) out.add(m);
  return [...out];
}

/** What several typed words mean when together they are exactly one of the known phrases ("happy hour", "board game"); null when they are not. */
export function phraseTerms(words: string[]): string[] | null {
  if (words.length < 2) return null;
  const phrase = words.join(' ');
  const g = GROUPS.find((x) => x.includes(phrase));
  return g ? [...g] : null;
}

/** Whether a text (a title, a place, tags...) answers what was typed: every typed word, or what means the same, is in it. No words typed: everything does. */
export function matchesSearch(text: string, q: string): boolean {
  const words = searchWords(q);
  if (words.length === 0) return true;
  const hay = plain(text);
  const inText = hay.split(/[^a-z0-9]+/).filter(Boolean);
  // typed as a phrase that means something as a whole ("happy hour"): the phrase is looked for as one thing
  const whole = phraseTerms(words);
  if (whole && whole.some((term) => hay.includes(term))) return true;
  return words.every((w) => {
    if (expandSearchWord(w).some((term) => hay.includes(term))) return true;
    // a typo in the text itself ("aperitvo" in a title)
    return w.length >= 5 && inText.some((x) => x.length >= 5 && distance(w, x) <= allowed(Math.max(w.length, x.length)));
  });
}
