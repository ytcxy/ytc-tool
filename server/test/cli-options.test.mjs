import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, targetDatabase } from '../scripts/shared.mjs';
const allowed=['--validate','--apply','--accept-changes'];
test('production requires explicit target, overriding only the database',()=>{
 assert.equal(targetDatabase(undefined,'ytc-tool'),'ytc-tool');
 assert.throws(()=>targetDatabase(undefined,'ytc-tool-prod'));
 assert.throws(()=>targetDatabase(undefined,undefined));
 assert.equal(targetDatabase('ytc-tool-prod','ytc-tool'),'ytc-tool-prod');
 assert.equal(targetDatabase('ytc-tool','ytc-tool-prod'),'ytc-tool');
 assert.throws(()=>targetDatabase('other','ytc-tool'));
});
test('target selection preserves dry-run unless apply is explicit',()=>{
 const plan=parseOptions(['--database=ytc-tool-prod'],allowed);
 assert.equal(plan.database,'ytc-tool-prod');assert.equal(plan.args.has('--apply'),false);
 const apply=parseOptions(['--apply','--database=ytc-tool-prod'],allowed);
 assert.equal(apply.args.has('--apply'),true);
});
test('CLI rejects ambiguous targets, unknown flags and incompatible options',()=>{
 for(const argv of [
  ['--database=other'],['--database='],['--database=ytc-tool','--database=ytc-tool-prod'],
  ['--aply'],['--validate','--database=ytc-tool-prod'],['--accept-changes'],['--apply','--apply']
 ])assert.throws(()=>parseOptions(argv,allowed));
 assert.throws(()=>parseOptions(['--accept-changes'],['--apply']));
 assert.equal(parseOptions(['--validate'],allowed).args.has('--validate'),true);
});
