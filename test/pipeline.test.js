import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raider-'));
process.chdir(tmp);
delete process.env.FULLENRICH_API_KEY;
const { FIXTURES } = await import('../src/fixtures.js');
const { runPipeline } = await import('../src/pipeline.js');
const { evaluate } = await import('../src/nenya.js');
const { saveEmailDraft } = await import('../src/sink.js');

const drafts = () => (fs.existsSync('emailReplies') ? fs.readdirSync('emailReplies') : []);

test('fixtures A/B/C: one draft written, two blocked before disk, all audited', async () => {
  const results = {};
  for (const id of ['A', 'B', 'C']) {
    const f = FIXTURES[id];
    results[id] = await runPipeline({ signal: f.signal, cached: f.resolution, quiet: true, fixtureId: id });
  }
  assert.equal(results.A.verdict.decision, 'PASS');
  assert.equal(results.A.savings.annual_savings, 184800);
  assert.equal(results.B.verdict.decision, 'ABORT_POLICY_VIOLATION');
  assert.equal(results.B.verdict.reason, 'seats < 20');
  assert.equal(results.C.verdict.decision, 'ABORT_COMPLIANCE_HOLD');
  assert.equal(results.C.verdict.reason, 'GDPR_unsolicited_cold');

  assert.deepEqual(drafts(), [path.basename(results.A.sink.file)]);
  assert.match(drafts()[0], /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
  const written = fs.readFileSync(path.join('emailReplies', drafts()[0]), 'utf8');
  assert.match(written, /^---\n[\s\S]*savings_delta: "\$184,800"[\s\S]*status: "QUEUED_FOR_REVIEW"[\s\S]*\n---\n/);

  const audit = fs.readFileSync('logs/nenya-audit.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(audit.map((a) => a.decision), ['PASS', 'ABORT_POLICY_VIOLATION', 'ABORT_COMPLIANCE_HOLD']);
});

test('tampered savings figure or forged verdict cannot reach disk', async () => {
  const { signal, resolution: contact } = FIXTURES.A;
  const good = (await runPipeline({ signal, cached: contact, quiet: true })).markdown;
  const before = drafts().length;
  assert.equal(evaluate({ markdown: good.replace('Worth a brief look', 'ACT NOW! Worth a brief look'), signal, contact }).decision, 'ABORT_TONE_VIOLATION');

  const tampered = good.replaceAll('$184,800', '$284,800');
  const verdict = evaluate({ markdown: tampered, signal, contact });
  assert.equal(verdict.decision, 'ABORT_GROUNDING_FAILURE');
  assert.equal(saveEmailDraft({ markdown: tampered, verdict }).status, 'WRITE_REFUSED');

  const forged = { ...evaluate({ markdown: good, signal, contact }) };
  assert.equal(saveEmailDraft({ markdown: good, verdict: forged }).status, 'WRITE_REFUSED');
  const passed = evaluate({ markdown: good, signal, contact });
  assert.equal(saveEmailDraft({ markdown: tampered, verdict: passed }).status, 'WRITE_REFUSED');
  assert.equal(drafts().length, before);
});

test('Cargo Script node output passes Nenya and matches the service draft', async () => {
  const { composeDraft } = await import('../src/draft.js');
  const { savingsDelta, parseUpliftPct } = await import('../src/math.js');
  const src = fs.readFileSync(new URL('../cargo/script-node.js', import.meta.url), 'utf8');
  const { signal, resolution: contact } = FIXTURES.A;
  const nodes = {
    start: { ...signal },
    fullenrich_company: { headcount: contact.headcount, locations: { headquarters: { city: 'Austin', region: 'TX', country_code: 'US' } } },
    fullenrich_person: { people: [{ first_name: contact.first_name, last_name: contact.last_name, title: contact.title }] },
    fullenrich_email: { most_probable_email: contact.email, most_probable_email_status: contact.email_status },
  };
  const out = new Function('nodes', src)(nodes);
  assert.deepEqual(JSON.parse(out.sink_body).markdown, out.markdown);
  assert.equal(out.savings.annual_savings, 184800);
  assert.equal(evaluate({ markdown: out.markdown, signal: out.signal, contact: out.contact }).decision, 'PASS');
  const stripClock = (md) => md.replace(/generated_at: ".*"/, '');
  const service = composeDraft({ signal, contact, savings: savingsDelta({ seats: contact.headcount, upliftPct: parseUpliftPct(signal.text) }) }).markdown;
  assert.equal(stripClock(out.markdown), stripClock(service));
});
