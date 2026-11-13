/**
 * A likely slip in an e-mail's domain («gamil.com», «gmial.com», «gmail.co»), and the address the
 * person probably meant. A code sent to a mistyped address never arrives (a pilot student signed up
 * as …@gamil.com), so the sign-in screen offers the fix before anything is sent. Only the domains
 * learners here use; anything else is left alone.
 */
const DOMAINS = [
  'gmail.com',
  'mail.ru',
  'yandex.ru',
  'yandex.com',
  'ya.ru',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  'rambler.ru',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'yahoo.com',
];

/** Edits between two words, a swap of neighbours counting as one (gmial → gmail). */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

/** The address with its domain corrected, or null when it looks right (or isn't close to any). */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const domain = email.slice(at + 1);
  if (DOMAINS.includes(domain)) return null;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const known of DOMAINS) {
    const d = distance(domain, known);
    if (d < bestDistance) {
      best = known;
      bestDistance = d;
    }
  }
  // Two slips at most, and only one in a short domain (bk.ru is not «by.ru»'s typo).
  const allowed = (best?.length ?? 0) <= 6 ? 1 : 2;
  return best && bestDistance > 0 && bestDistance <= allowed ? `${email.slice(0, at)}@${best}` : null;
}
