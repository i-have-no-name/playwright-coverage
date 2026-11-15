import assert from 'node:assert/strict';
import { scan } from './report.mjs';

const { sites, notes } = scan();
const flows = sites.map(
  (site) => `${site.place} › ${site.handler} → ${site.action} → ${site.command.topic}${site.trigger ? ` via ${site.trigger.file}:${site.trigger.line}` : ''}`,
);
const expected = {
  'slice action called through bindActionCreators': 'Reactions › onClick → reactions/cleared → reaction.clear',
  'hook that wraps dispatch, first caller': 'useReactions › Reactions.onClick → reactions/added → reaction.add via src/components/Reactions.tsx:16',
  'hook that wraps dispatch, second caller': 'useReactions › Reactions.onClick → reactions/added → reaction.add via src/components/Reactions.tsx:17',
  'slice action put by a saga': 'clearReactionLater › (body) → reactions/cleared → reaction.clear',
};
for (const [pattern, flow] of Object.entries(expected)) {
  assert.ok(flows.includes(flow), `${pattern}: flow not found\n  expected: ${flow}\n  found:\n    ${flows.join('\n    ')}`);
}
assert.deepEqual(notes.filter((note) => /reaction/i.test(`${note.file} ${note.text}`)), []);
console.log(`scan check passed: ${Object.keys(expected).length} pattern flows found among ${flows.length}`);
