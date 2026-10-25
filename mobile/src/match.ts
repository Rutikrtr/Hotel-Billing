// Finding dishes from what a waiter types or says: "chin biryani" → Chicken Biryani, "puneri misal" → Puneri Misal.
// Indian dish names are spelt many ways (paneer/panir, bhaji/baji), so words are compared by sound, not letter by letter.

/** Rough sound-alike form of a word: lower case, h after consonants dropped, doubled letters and long vowels squeezed. */
export function soundOf(word: string): string {
  return word.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/([bcdgjkpt])h/g, '$1')        // bhaji → baji, kheer → keer
    .replace(/sh/g, 's').replace(/ph/g, 'f').replace(/z/g, 'j').replace(/w/g, 'v').replace(/q/g, 'k').replace(/ck/g, 'k').replace(/c(?=[aou])/g, 'k')
    .replace(/ee|ea|ie|ii|y(?=[^aeiou]|$)/g, 'i').replace(/oo|ou|uu/g, 'u').replace(/aa/g, 'a')
    .replace(/(.)\1+/g, '$1');                // butterr → buter
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** How well one heard/typed word fits one word of a dish name (0..1). Start-of-word matches count fully ("chin" → chicken). */
function wordScore(said: string, word: string): number {
  if (!said || !word) return 0;
  if (word.startsWith(said) || (said.length >= 4 && said.startsWith(word))) return said.length >= 2 ? 1 : 0.6;
  // Compare with the start of the word at a few lengths, so a short spoken word can match a longer name.
  let d = distance(said, word);
  for (let n = Math.max(1, said.length - 1); n <= Math.min(word.length, said.length + 2); n++) d = Math.min(d, distance(said, word.slice(0, n)));
  return Math.max(0, 1 - d / Math.max(said.length, 3));
}

const words = (s: string) => s.split(/[\s,.\-/()&]+/).map(soundOf).filter(Boolean);

/** Score of a whole search against a dish name (0..1). Every searched word must fit some word of the name. */
export function matchScore(search: string, name: string): number {
  const said = words(search);
  if (!said.length) return 1;
  const dish = words(name);
  if (!dish.length) return 0;
  let total = 0;
  for (const w of said) {
    const best = Math.max(...dish.map((d) => wordScore(w, d)));
    if (best < 0.55) return 0;
    total += best;
  }
  // Prefer names that are covered by the search (Misal over Misal Pav for "misal").
  return (total / said.length) * (0.85 + 0.15 * Math.min(1, said.length / dish.length));
}

/** Dishes that fit the search, best first. Exact text matches always come first. */
export function findDishes<T extends { name: string }>(search: string, list: T[]): T[] {
  const s = search.trim().toLowerCase();
  if (!s) return list;
  return list
    .map((m) => ({ m, score: m.name.toLowerCase().includes(s) ? 2 : matchScore(s, m.name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}
