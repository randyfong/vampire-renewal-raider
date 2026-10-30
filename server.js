// HTTP surface for Cargo HTTP "Call" nodes. Zero dependencies.
//   GET  /health                 liveness
//   GET  /fixtures               the A/B/C ingest queue
//   GET  /drafts                 emailReplies/ listing, newest first
//   POST /ingest   {fixture:"A"} | {signal, cached?}            full pipeline in one call
//   POST /compose  {signal, contact}                            Cargo math + markdown (no write)
//   POST /sink     {signal, contact, markdown, opt_in?}         Nenya evaluates, then writes only on PASS
// Set RAIDER_TOKEN to require header `x-raider-token` (do this before exposing a tunnel).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { composeDraft } from './src/draft.js';
import { FIXTURES, getFixture } from './src/fixtures.js';
import { log } from './src/log.js';
import { parseUpliftPct, savingsDelta } from './src/math.js';
import { appendAudit, evaluate } from './src/nenya.js';
import { runPipeline } from './src/pipeline.js';
import { saveEmailDraft } from './src/sink.js';

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.RAIDER_TOKEN;
const DRAFTS = path.resolve(process.cwd(), 'emailReplies');

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
};

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('body too large'), { status: 413 });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}

const need = (obj, keys) => {
  const missing = keys.filter((k) => obj?.[k] == null || obj[k] === '');
  if (missing.length) throw Object.assign(new Error(`missing fields: ${missing.join(', ')}`), { status: 400 });
};

// Demo streams report real pipeline observations. Only demo-created drafts are reset.
const streams = new Map();
const demoDrafts = new Set();
let demoBusy = false;
const publicDir = new URL('./public/', import.meta.url);
const assets = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };

const routes = {
  'GET /health': () => [200, { ok: true, service: 'vampire-renewal-raider' }],
  'GET /fixtures': () => [200, FIXTURES],
  'GET /drafts': () => [200, fs.existsSync(DRAFTS)
    ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.md')).sort().reverse()
    : []],
  'POST /ingest': async (body) => {
    const fixture = body.fixture ? getFixture(body.fixture) : null;
    const signal = fixture?.signal ?? body.signal;
    need(signal, ['text', 'domain', 'company_name']);
    const result = await runPipeline({
      signal: { platform: 'reddit', community: 'r/salesforce', source_url: '', ...signal },
      cached: fixture?.resolution ?? body.cached ?? body.contact,
      optIn: Boolean(body.opt_in),
      fixtureId: fixture?.id,
    });
    const { verdict, sink, savings, contact } = result;
    return [verdict.decision === 'PASS' ? 200 : 422, { decision: verdict.decision, reason: verdict.reason, sink, savings, contact, rules: verdict.rules }];
  },
  'POST /compose': async (body) => {
    need(body, ['signal', 'contact']);
    const savings = savingsDelta({ seats: Number(body.contact.headcount), upliftPct: parseUpliftPct(body.signal.text) });
    return [200, { savings, markdown: composeDraft({ signal: body.signal, contact: body.contact, savings }).markdown }];
  },
  'POST /sink': async (body, soft) => {
    need(body, ['signal', 'contact', 'markdown']);
    const verdict = evaluate({ markdown: body.markdown, signal: body.signal, contact: body.contact, optIn: Boolean(body.opt_in) });
    const sink = saveEmailDraft({ markdown: body.markdown, verdict });
    log('NENYA', `${verdict.decision} ${verdict.domain} (${verdict.reason}) via /sink`);
    appendAudit({ at: verdict.evaluated_at, via: 'http:/sink', domain: verdict.domain, decision: verdict.decision, reason: verdict.reason, policy_version: verdict.policy_version, failed_rules: verdict.rules.filter((r) => !r.ok).map((r) => r.id), draft_sha256: verdict.draft_sha256, file: sink.file ?? null });
    // ?soft=1 (Cargo HTTP node): always 200 so a Nenya abort is a clean run result, not a failed node.
    return [sink.status === 'DRAFT_SAVED' || soft ? 200 : 422, { decision: verdict.decision, reason: verdict.reason, sink, rules: verdict.rules }];
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && assets[url.pathname]) {
    const [file, type] = assets[url.pathname];
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(new URL(file, publicDir)));
  }
  if (url.pathname.startsWith('/demo/')) {
    if (TOKEN && req.headers['x-raider-token'] !== TOKEN) return send(res, 401, { error: 'bad token' });
    const id = url.searchParams.get('run');
    if (req.method === 'GET' && url.pathname === '/demo/events') {
      if (!id || streams.has(id) || streams.size >= 16) return send(res, 400, { error: 'invalid stream' });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.write(JSON.stringify({ stage: 'ready' }) + '\n');
      streams.set(id, res);
      const timeout = setTimeout(() => res.end(), 60000);
      res.on('close', () => { clearTimeout(timeout); streams.delete(id); });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/demo/reset') {
      if (demoBusy) return send(res, 409, { error: 'Wait for the current lead to finish.' });
      for (const file of demoDrafts) fs.rmSync(file, { force: true });
      demoDrafts.clear();
      return send(res, 200, { reset: true });
    }
    if (req.method === 'POST' && url.pathname === '/demo/run') {
      if (demoBusy) return send(res, 409, { error: 'A lead is already running.' });
      const stream = streams.get(id);
      if (!stream) return send(res, 400, { error: 'Open a stage stream first.' });
      demoBusy = true;
      try {
        const body = await readJson(req);
        const fixture = getFixture(body.fixture);
        const result = await runPipeline({ signal: fixture.signal, cached: fixture.resolution, fixtureId: fixture.id, pace: 450,
          onStage: async (stage, data) => {
            // Register the artifact at creation, even if the browser disconnects.
            if (stage === 'sink' && data.sink.file) demoDrafts.add(path.resolve(data.sink.file));
            stream.write(JSON.stringify({ stage, ...data }) + '\n');
            await new Promise((resolve) => setTimeout(resolve, 180));
          },
        });
        return send(res, result.verdict.decision === 'PASS' ? 200 : 422, result);
      } catch (err) {
        return send(res, err.message.startsWith('unknown fixture') ? 400 : 500, { error: err.message });
      } finally { demoBusy = false; stream.end(); streams.delete(id); }
    }
    return send(res, 404, { error: 'not found' });
  }
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: 'not found' });
  if (TOKEN && !req.url.startsWith('/health') && req.headers['x-raider-token'] !== TOKEN) return send(res, 401, { error: 'bad token' });
  try {
    const url = new URL(req.url, 'http://x');
    const [status, body] = await route(req.method === 'POST' ? await readJson(req) : {}, url.searchParams.get('soft') === '1');
    return send(res, status, body);
  } catch (err) {
    return send(res, err.status ?? (err.message.startsWith('unknown fixture') ? 400 : 500), { error: err.message });
  }
});

server.listen(PORT, () => console.log(`vampire-renewal-raider listening on http://localhost:${PORT}${TOKEN ? ' (token required)' : ''}`));
