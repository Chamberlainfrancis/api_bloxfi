/**
 * Contract: partner-facing error *copy* must not embed provider brand names.
 *
 * Scans AppError / forwarded Error / Zod `message` / questionnaire `hint`
 * string literals under `/api/v1` and the few core constructors whose
 * `.message` is returned to clients unchanged.
 *
 * Middleware redaction remains defense-in-depth; this test fails the PR when
 * a new `AppError('…Palremit…')` (or similar) is introduced — including by AI.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { containsProviderName } from '@/utils/redactProviderNames';

const SRC_ROOT = join(__dirname, '..');

const SCAN_ROOTS = [
  join(SRC_ROOT, 'api', 'v1'),
  join(SRC_ROOT, 'middleware', 'error.ts'),
  // `.message` is returned to clients via controllers:
  join(SRC_ROOT, 'core', 'integrations', 'graphOnrampKyc.ts'),
  join(SRC_ROOT, 'core', 'integrations', 'palremitCoinNetworks.ts'),
  join(SRC_ROOT, 'core', 'accounts', 'createAccount.ts'),
];

const SKIP_FILE = /\.(test|spec)\.ts$/;

/** Single- or double-quoted string literals only (no templates — avoids comment false positives). */
function extractQuotedStrings(source: string): Array<{ value: string; index: number }> {
  const out: Array<{ value: string; index: number }> = [];
  const re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const raw = m[0];
    out.push({
      index: m.index,
      value: raw.slice(1, -1).replace(/\\(['"\\nrt])/g, (_, c: string) => {
        if (c === 'n') return '\n';
        if (c === 'r') return '\r';
        if (c === 't') return '\t';
        return c;
      }),
    });
  }
  return out;
}

/**
 * True when this quoted string is used as partner-visible error / validation copy.
 * Looks at a short window before the quote.
 */
function isClientFacingErrorString(source: string, quoteIndex: number): boolean {
  const before = source.slice(Math.max(0, quoteIndex - 80), quoteIndex);
  return (
    /new\s+AppError\s*\(\s*$/.test(before) ||
    /throw\s+new\s+Error\s*\(\s*$/.test(before) ||
    /throw\s+new\s+Error\s*\(\s*`[^`]*\$\{[^}]*\}\s*$/.test(before) ||
    /super\s*\(\s*$/.test(before) ||
    /super\s*\(\s*`[^`]*\$\{[^}]*\}\s*$/.test(before) ||
    /\bmessage\s*:\s*$/.test(before) ||
    /\bhint\s*:\s*$/.test(before) ||
    // `new AppError(e.message.replace(...), …)` — the replace template is client-facing when used as AppError arg
    /AppError\s*\(\s*e\.message\.replace\([^,]+,\s*$/.test(before) ||
    /AppError\s*\(\s*[`'"]/.test(before.slice(-20) + source.slice(quoteIndex, quoteIndex + 1))
  );
}

function walkTsFiles(entry: string, out: string[]): void {
  let st;
  try {
    st = statSync(entry);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (entry.endsWith('.ts') && !SKIP_FILE.test(entry)) out.push(entry);
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of readdirSync(entry)) {
    if (name === 'node_modules' || name === 'dist') continue;
    walkTsFiles(join(entry, name), out);
  }
}

describe('partner-facing error copy must not name providers', () => {
  it('flags AppError / Error / Zod message / hint strings that contain provider brands', () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      walkTsFiles(root, files);
    }
    expect(files.length).toBeGreaterThan(10);

    const leaks: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Also catch `super(\`…${}\`)` GraphOnrampKycError style via dedicated check below.
      for (const { value, index } of extractQuotedStrings(source)) {
        if (!containsProviderName(value)) continue;
        if (!isClientFacingErrorString(source, index)) continue;
        leaks.push(
          `${relative(SRC_ROOT, file)}: "${value.slice(0, 140)}${value.length > 140 ? '…' : ''}"`
        );
      }

      // Template literals used as Error/AppError/super first arg: `…${x}…`
      const tmplRe =
        /(?:new\s+AppError|throw\s+new\s+Error|super)\s*\(\s*`((?:\\.|[^`\\]|\$\{[^}]*\})*)`/g;
      let tm: RegExpExecArray | null;
      while ((tm = tmplRe.exec(source)) !== null) {
        const body = tm[1] ?? '';
        // Check static segments only (ignore ${…}).
        const staticParts = body.split(/\$\{[^}]*\}/);
        if (staticParts.some((p) => containsProviderName(p))) {
          leaks.push(
            `${relative(SRC_ROOT, file)}: \`${body.slice(0, 140)}${body.length > 140 ? '…' : ''}\``
          );
        }
      }
    }

    expect(leaks, `Provider brand(s) in partner-facing error copy:\n${leaks.join('\n')}`).toEqual(
      []
    );
  });

  it('keeps error middleware redaction wired for /api/v1', () => {
    const source = readFileSync(join(SRC_ROOT, 'middleware', 'error.ts'), 'utf8');
    expect(source).toContain('redactProviderNamesFromClientMessage');
    expect(source).toContain('isPartnerFacingPath');
  });
});
