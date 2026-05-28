/**
 * robots.txt 最小パーサ + フィルタ。
 *
 * 必要十分な spec カバレッジ:
 *   - User-agent セクション (UA 一致 + `*` セクションを併合、 UA 一致が優先)
 *   - Disallow / Allow ルール
 *   - `*` ワイルドカード (任意文字列にマッチ)
 *   - `$` 末尾アンカー
 *   - 最長 pattern マッチ優先で allow/disallow を決定 (Google / Bing 流)
 *
 * 対象外 (今回はスコープ外):
 *   - Crawl-delay (rate-limit 系は別 Issue)
 *   - Sitemap directive
 *   - 複数 UA セクション結合の細かな仕様
 *
 * fail-open 原則: robots.txt が無い (404 / fetch error) サイトは「すべて allow」
 * として扱う (Issue #101 の受け入れ条件)。
 */

export interface RobotsRule {
  /** path に対する正規表現 (line 内の literal + `*` ワイルドカード + `$` 末尾アンカー)。 */
  re: RegExp;
  /** 元のパターン文字列 (最長マッチ判定で長さを使う)。 */
  patternLength: number;
  allow: boolean;
}

export interface RobotsRules {
  rules: RobotsRule[];
}

const EMPTY_RULES: RobotsRules = { rules: [] };

/**
 * robots.txt の本文と user-agent を受け取り、 該当 UA 用の rule 集合を返す。
 * UA section が無い場合は `*` section にフォールバック。
 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const lines = text.split(/\r?\n/);
  const ua = userAgent.toLowerCase();

  interface Section {
    uas: string[];
    rules: { allow: boolean; path: string }[];
  }

  const sections: Section[] = [];
  let current: Section | null = null;
  let lastDirectiveWasUA = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      // 連続する User-agent 行は同一 section にグルーピング
      if (!lastDirectiveWasUA || !current) {
        current = { uas: [], rules: [] };
        sections.push(current);
      }
      current.uas.push(value.toLowerCase());
      lastDirectiveWasUA = true;
      continue;
    }

    lastDirectiveWasUA = false;
    if (!current) continue;
    if (key === 'disallow') {
      current.rules.push({ allow: false, path: value });
    } else if (key === 'allow') {
      current.rules.push({ allow: true, path: value });
    }
    // crawl-delay / sitemap は今回 skip
  }

  // UA マッチ section を集める。 完全一致 > prefix 一致 > `*` の順で優先。
  const matched: { weight: number; section: Section }[] = [];
  for (const sec of sections) {
    let weight = 0;
    for (const declared of sec.uas) {
      if (declared === ua) weight = Math.max(weight, 3);
      else if (declared !== '*' && ua.startsWith(declared)) weight = Math.max(weight, 2);
      else if (declared === '*') weight = Math.max(weight, 1);
    }
    if (weight > 0) matched.push({ weight, section: sec });
  }

  if (matched.length === 0) return EMPTY_RULES;

  // 最高 weight (= 最も具体的な UA マッチ) のみ採用。 Google 仕様。
  const maxWeight = Math.max(...matched.map((m) => m.weight));
  const top = matched.filter((m) => m.weight === maxWeight);

  const rules: RobotsRule[] = [];
  for (const { section } of top) {
    for (const r of section.rules) {
      if (r.path === '') {
        // 空の Disallow: は「すべて allow」、 空の Allow: は no-op (= 同上)。
        if (!r.allow) continue;
        continue;
      }
      rules.push({
        re: patternToRegex(r.path),
        patternLength: r.path.length,
        allow: r.allow,
      });
    }
  }
  return { rules };
}

/**
 * robots.txt 文字列パターンを正規表現に変換する。
 * `*` → `.*`、 末尾 `$` → 末尾アンカー、 それ以外は literal。
 * 必ず path 先頭 (`/`) から match させる。
 */
function patternToRegex(pattern: string): RegExp {
  const endsWithAnchor = pattern.endsWith('$');
  const body = endsWithAnchor ? pattern.slice(0, -1) : pattern;
  // regex meta を escape (ただし `*` は wildcard なので別扱い)
  let re = '';
  for (const ch of body) {
    if (ch === '*') re += '.*';
    else if ('\\.+?()[]{}|^$'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  const suffix = endsWithAnchor ? '$' : '';
  return new RegExp('^' + re + suffix);
}

/**
 * 与えた path (= URL の pathname + search) が rules で allow されるか判定する。
 * fail-open: rules が null / 空 → true。
 *
 * Google 流の "最長一致 wins" 規則。 同 length なら allow を優先 (= 競合時は緩い側)。
 */
export function isAllowedByRobots(rules: RobotsRules | null, path: string): boolean {
  if (!rules || rules.rules.length === 0) return true;
  let bestLen = -1;
  let bestAllow = true;
  for (const r of rules.rules) {
    const m = path.match(r.re);
    if (!m) continue;
    const len = r.patternLength;
    if (len > bestLen) {
      bestLen = len;
      bestAllow = r.allow;
    } else if (len === bestLen && r.allow) {
      bestAllow = true; // tie-break: 緩い側を優先
    }
  }
  return bestAllow;
}

/**
 * 1 origin につき 1 回だけ robots.txt を fetch するキャッシュ付き取得器を作る。
 * fetch error / 404 / timeout は fail-open (null を返し、 呼び出し側で allow 扱い)。
 */
export function createRobotsCache(userAgent: string, fetchTimeoutMs = 5000) {
  const cache = new Map<string, RobotsRules | null>();
  return async function getRobots(origin: string): Promise<RobotsRules | null> {
    const cached = cache.get(origin);
    if (cached !== undefined) return cached;

    const url = origin.replace(/\/$/, '') + '/robots.txt';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), fetchTimeoutMs);
    let rules: RobotsRules | null = null;
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'user-agent': userAgent, accept: 'text/plain,*/*' },
      });
      if (res.ok) {
        const text = await res.text();
        rules = parseRobots(text, userAgent);
      } else {
        // 404 / 5xx は「無い」と同義 = 全 allow (fail-open)
        rules = null;
      }
    } catch {
      // fetch error / timeout も fail-open
      rules = null;
    } finally {
      clearTimeout(timer);
    }
    cache.set(origin, rules);
    return rules;
  };
}
