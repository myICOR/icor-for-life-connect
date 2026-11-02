/* THE NEW NOTE SCOPE GATE (Tool Lab item 12).
 *
 * Interface's "Obsidian's own file controls" switch promises New note back.
 * It keeps that promise by taking `icor-scaffold-chrome` off <body>: the class
 * is there only while the scaffold's reduced chrome is on, the same class
 * INKLINE guards its copy of this rule with. One unscoped selector with
 * `!important` breaks the switch, so every selector of every rule that can
 * reach the button is held to the class, wherever in the stylesheet it sits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS_PATH = new URL(process.env.CONNECT_CSS ?? '../styles.css', import.meta.url);
const SCOPE = 'body.icor-scaffold-chrome ';
const NEW_NOTE = /\[aria-label="New note"\]|svg\.lucide-(?:edit|edit-3|pen-box)\b/;

function selectors(css) {
  const out = [];
  for (const [, prelude] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    for (const part of prelude.split(',')) out.push(part.trim());
  }
  return out;
}

test('every selector that reaches the New note button needs the scaffold chrome class', () => {
  const hits = selectors(readFileSync(CSS_PATH, 'utf8')).filter((s) => s.includes('.nav-buttons-container') && NEW_NOTE.test(s));
  assert.equal(hits.length, 4, 'the aria-label selector and the three icon selectors');
  for (const s of hits) assert.ok(s.startsWith(SCOPE), `unscoped: ${s}`);
});
