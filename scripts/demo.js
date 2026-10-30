// Live demo runner: node scripts/demo.js [--fixtures A,B,C] [--pace 700]
import { getFixture } from '../src/fixtures.js';
import { c } from '../src/log.js';
import { runPipeline } from '../src/pipeline.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ids = opt('fixtures', 'A,B,C').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const pace = Number(opt('pace', process.env.DEMO_PACE ?? 700));

const summary = [];
for (const id of ids) {
  const fixture = getFixture(id);
  console.log(`\n${c.bold(`━━━ Fixture ${id} · ${fixture.label} · ${fixture.signal.domain} ━━━`)}`);
  const { verdict, sink } = await runPipeline({ signal: fixture.signal, cached: fixture.resolution, pace, fixtureId: id });
  summary.push({ id, domain: fixture.signal.domain, decision: verdict.decision, reason: verdict.reason, file: sink.file ?? '-', expected: fixture.expected });
  await new Promise((r) => setTimeout(r, pace));
}

console.log(`\n${c.bold('━━━ Nenya outcome ━━━')}`);
for (const s of summary) {
  const ok = s.decision === s.expected;
  const decision = s.decision === 'PASS' ? c.greenBold(s.decision) : c.redBold(s.decision);
  console.log(` ${ok ? c.green('●') : c.red('●')} ${s.id} ${s.domain.padEnd(16)} ${decision} ${c.dim(s.decision === 'PASS' ? s.file : s.reason)}`);
}
const written = summary.filter((s) => s.file !== '-').length;
console.log(` ${c.bold(`${written} draft(s) written, ${summary.length - written} blocked before disk`)}\n`);
process.exitCode = summary.every((s) => s.decision === s.expected) ? 0 : 1;
