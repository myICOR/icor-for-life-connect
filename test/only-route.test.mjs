/* THE ONLY-ROUTE GATE.
 *
 * A control that is the last path to a function may never be hidden. Hiding
 * one does not relocate the function, it deletes it, and it deletes it
 * silently: the user does not get an error, they get an Obsidian that can no
 * longer do something Obsidian can do.
 *
 * This gate exists because that shipped. `Change sort order` was hidden by a
 * rule written while the toolbar was being emptied wholesale, and the host
 * registers no command for sorting, so the shipped build removed the only way
 * to sort a file tree. It was found by review, not by a test, because this
 * repository had no tests.
 *
 * The list below is FACTS ABOUT THE HOST, measured against the Obsidian app
 * bundle rather than assumed, and each entry carries the measurement. To take
 * something off this list, find the command that replaces it and say so here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(repo, 'styles.css'), 'utf8');

/* Comments are blanked across the WHOLE file before scanning, line numbers
   kept. A per-line strip misses every continuation line of a block comment,
   and this file explains the ban in prose that names the banned selector. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const ONLY_ROUTE = [
  {
    label: 'Change sort order',
    why: 'Obsidian registers eight file-explorer: commands and none of them '
       + 'sorts; a bundle-wide search for a command id containing "sort" '
       + 'returns nothing. This button is the only route.',
  },
];

/* The controls that MAY be hidden, and the command that makes it safe. Kept
   beside the list above so the difference between the two is visible rather
   than remembered. */
const HAS_ANOTHER_ROUTE = [
  ['New note', 'the plugin registers New unique note; core Daily notes registers its own'],
  ['Reveal current file', 'file-explorer:reveal-active-file'],
  ['New folder', 'deliberately removed as a function; rooms are the AI team\'s job'],
];

for (const { label, why } of ONLY_ROUTE) {
  test(`the "${label}" control is never hidden by this stylesheet`, () => {
    const offenders = code.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line.includes(`aria-label="${label}"`));
    assert.deepEqual(offenders, [],
      `${label} is the only route to its function. ${why}\n`
      + `Hiding it deletes the function rather than moving it:\n`
      + JSON.stringify(offenders, null, 2));
  });
}

/* CARDINALITY. A gate that passes having measured nothing is not a gate, and
   this one would go green on an empty list, a renamed constant, or a stylesheet
   that failed to load. All three have happened in this codebase. */
test('the only-route gate actually has a subject', () => {
  assert.ok(ONLY_ROUTE.length > 0, 'the only-route list is empty, so the loop above asserted nothing');
  assert.ok(css.length > 1000, 'styles.css did not load, so every selector scan below it is vacuous');
  assert.ok(code.includes('.nav-buttons-container'),
    'no .nav-buttons-container rule survives in styles.css - this gate is scanning a file that no '
    + 'longer describes the toolbar, so its green means nothing');
});

/* The negative control: the scan must be able to SEE a hide rule. Without
   this, a broken matcher reports clean forever. */
test('the scanner can detect a hide rule when one exists', () => {
  const planted = '.nav-buttons-container .clickable-icon[aria-label="Change sort order"] { display: none; }';
  const hits = planted.split('\n').filter((l) => l.includes('aria-label="Change sort order"'));
  assert.equal(hits.length, 1, 'the matcher cannot see a hide rule it was handed directly');
});
