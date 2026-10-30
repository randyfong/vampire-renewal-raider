import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('demo streams actual stages, preserves APIs, returns 422, resets only its own drafts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raider-ui-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.copyFileSync(path.join(root, 'data/exclusions.json'), path.join(dir, 'data/exclusions.json'));
  fs.mkdirSync(path.join(dir, 'emailReplies'));
  fs.writeFileSync(path.join(dir, 'emailReplies/keep.md'), 'existing draft');
  const port = 19000 + Math.floor(Math.random() * 10000);
  const server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: dir, env: { ...process.env, PORT: String(port), FULLENRICH_MODE: 'cached', RAIDER_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', (code) => reject(new Error(`server exited ${code}`))); });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.ok((await (await fetch(base + '/fixtures')).json()).D);
    assert.match(await (await fetch(base)).text(), /Vampire/);
    assert.equal((await fetch(base + '/app.js')).status, 200);
    for (const id of ['A', 'B', 'C', 'D']) {
      const stream = await fetch(`${base}/demo/events?run=${id}`);
      const events = stream.text();
      const response = await fetch(`${base}/demo/run?run=${id}`, { method: 'POST', body: JSON.stringify({ fixture: id }) });
      const result = await response.json();
      assert.equal(response.status, id === 'A' ? 200 : 422);
      assert.deepEqual((await events).trim().split('\n').map((line) => JSON.parse(line).stage), ['ready', 'ingest', 'fullenrich', 'cargo', 'guardrails', 'sink']);
      if (id === 'A') { assert.equal(result.savings.annual_savings, 184800); assert.match(result.markdown, /# Subject:/); }
      else assert.equal(result.sink.status, 'WRITE_REFUSED');
      if (id === 'D') assert.equal(result.verdict.reason, 'domain_in_customers');
    }
    assert.equal(fs.readdirSync(path.join(dir, 'emailReplies')).length, 2);
    assert.equal((await fetch(base + '/demo/reset', { method: 'POST' })).status, 200);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'emailReplies')), ['keep.md']);
    assert.equal((await fetch(base + '/demo/reset', { method: 'POST' })).status, 200);
  } finally { server.kill(); await new Promise((resolve) => server.once('exit', resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
