// Fire fixtures through the deployed Cargo tool (runs show on the Cargo canvas / Traces).
//   SINK_URL=https://<tunnel> RAIDER_TOKEN=... node scripts/cargo-trigger.js A,B,C
// Uses the signed-in Cargo CLI (`cargo-ai login`). Workflow: vampire_renewal_raider.
import { execFileSync } from 'node:child_process';
import { getFixture } from '../src/fixtures.js';

const WORKFLOW_UUID = process.env.CARGO_WORKFLOW_UUID ?? 'ef5575c8-b015-479c-a797-e3fce07d1a3e';
const { SINK_URL, RAIDER_TOKEN } = process.env;
if (!SINK_URL || !RAIDER_TOKEN) {
  console.error('set SINK_URL (tunnel URL from scripts/tunnel.sh) and RAIDER_TOKEN');
  process.exit(2);
}

for (const id of (process.argv[2] ?? 'A,B,C').split(',')) {
  const { signal, resolution } = getFixture(id.trim());
  // Start inputs: the signal, plus cached enrichment the Script node uses where FullEnrich returns nothing.
  const data = { ...signal, ...resolution, sink_url: SINK_URL, sink_token: RAIDER_TOKEN };
  const t0 = Date.now();
  const raw = execFileSync('cargo-ai', [
    'orchestration', 'run', 'create', '--workflow-uuid', WORKFLOW_UUID, '--data', JSON.stringify(data),
    '--wait-until-finished', '--polling-interval', '1000',
  ], { encoding: 'utf8' });
  const run = JSON.parse(raw);
  const r = run.run ?? run;
  console.log(`\nFixture ${id} -> Cargo run ${r.uuid} ${r.status} in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(r.output ?? r.errorMessage ?? r, null, 2).slice(0, 3000));
}
