#!/usr/bin/env node
/**
 * Public repository security gate. Fails (exit 1) when tracked or staged
 * files contain site-specific identifiers, real backup files, or Cyrillic text.
 *
 *   npm run security:check
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`SECURITY GATE FAIL: ${msg}`);
};

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // git grep exits with 1 when there are no matches.
    if (e.status === 1) return '';
    throw e;
  }
}

// 1) Site identifier patterns (pattern split so this file never matches itself).
const pattern = ['10\\.104\\.', '443' + '117', 'Offline' + 'DriveInfo'].join('|');
for (const scope of [[], ['--cached']]) {
  const out = git(['grep', '-n', '-I', '-E', ...scope, pattern]);
  if (out.trim()) fail(`site identifiers found ${scope.length ? '(staged)' : '(tracked)'}:\n${out}`);
}

// 2) Forbidden file types must never be tracked or staged.
const files = new Set(
  [...git(['ls-files']).split('\n'), ...git(['diff', '--cached', '--name-only']).split('\n')].filter(Boolean),
);
const forbidden = [...files].filter((f) => /\.(dcparamsbak|dcparams|bin|pdf)$/i.test(f) || /(^|\/)\.local-fixtures\//.test(f));
if (forbidden.length) fail(`forbidden files tracked/staged:\n  ${forbidden.join('\n  ')}`);

// 3) Zero Cyrillic characters in tracked text files.
const cyr = new RegExp('[\\u0400-\\u04FF]');
for (const f of files) {
  if (/\.(png|jpe?g|gif|ico|webp|woff2?|ttf)$/i.test(f)) continue;
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue;
  }
  if (buf.includes(0)) continue; // binary file
  if (cyr.test(buf.toString('utf-8'))) fail(`Cyrillic text in ${f}`);
}

if (failed) process.exit(1);
console.log(`Security gate passed: ${files.size} files checked, 0 site identifiers, 0 forbidden files, 0 Cyrillic characters.`);
