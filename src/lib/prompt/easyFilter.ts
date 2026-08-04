import { StringLRU } from '@/lib/lru';
import { sanitizePrompt } from '@/lib/prompt/sanitize';

export function isLettersOnly(w: string) {
  return /^[a-z]+$/.test(w);
}

export function isEasyWord(w: string, maxLen = 8) {
  const s = String(w).toLowerCase();
  return s.length > 0 && s.length <= maxLen && isLettersOnly(s);
}

export type EasyFilterOptions = {
  maxLen?: number;
  maxRepeat?: number;
  random?: () => number;
};

// Replace any token that isn't "easy" with an easy fallback from `pool`.
// Also removes immediate duplicates, preserving length.
export function normalizeToEasyTokens(
  tokens: string[],
  pool: string[],
  opts?: EasyFilterOptions
) {
  const maxLen = Math.max(1, opts?.maxLen ?? 8);
  const maxRepeat = Math.max(1, opts?.maxRepeat ?? 2);
  const random = opts?.random ?? Math.random;
  const easy = pool.filter(w => isEasyWord(w, maxLen));
  const safePool = easy.length > 0 ? easy : tokens.filter(t => isEasyWord(t, maxLen));
  const out: string[] = [];
  const counts = new Map<string, number>();
  const lru = new StringLRU(2048, []);

  const pick = (): string => {
    for (let i = 0; i < 8; i++) {
      const cand = safePool[(random() * safePool.length) | 0];
      const c = counts.get(cand) ?? 0;
      if (c < maxRepeat && !lru.has(cand)) return cand;
    }
    return safePool[(random() * safePool.length) | 0];
  };

  let prev = '';
  for (const tok of tokens) {
    let t = String(tok).toLowerCase();
    t = sanitizePrompt(t, { allowPunctuation: false, allowNumbers: false });
    if (!isEasyWord(t, maxLen)) t = pick();
    if (t === prev) t = pick();
    out.push(t);
    counts.set(t, (counts.get(t) ?? 0) + 1);
    lru.add(t);
    prev = t;
  }
  return out;
}

export function applyEasyFilter(text: string, pool: string[], opts?: EasyFilterOptions) {
  const tokens = String(text).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text;
  const fixed = normalizeToEasyTokens(tokens, pool, opts);
  return fixed.join(' ');
}


