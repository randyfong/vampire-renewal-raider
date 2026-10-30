// Ingest -> FullEnrich -> Cargo (math + draft) -> Nenya -> file sink. One function, used by the CLI demo and the HTTP server.
import { composeDraft } from './draft.js';
import { resolveContact } from './fullenrich.js';
import { c, log } from './log.js';
import { formatUsd, parseUpliftPct, savingsDelta } from './math.js';
import { appendAudit, evaluate } from './nenya.js';
import { saveEmailDraft } from './sink.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runPipeline({ signal, cached, optIn = false, now, pace = 0, quiet = false, fixtureId, onStage = () => {} }) {
  const say = (stage, msg) => log(stage, msg, { quiet });
  const tag = fixtureId ? `Fixture ${fixtureId} ` : '';

  say('INGEST', `${tag}${signal.community ?? signal.platform}: ${c.bold(`"${signal.text}"`)}`);
  say('INGEST', `payload domain=${c.bold(signal.domain)} source=${signal.source_url}`);
  await onStage('ingest', { signal });
  await sleep(pace);

  const t0 = Date.now();
  const enrichment = await resolveContact({ signal, cached, log: (m) => say('FULLENRICH', m) });
  const contact = enrichment.contact;
  say('FULLENRICH', `resolved ${c.bold(`${contact.first_name} ${contact.last_name}`)}, ${contact.title} <${contact.email}> [${contact.email_status}]`);
  say('FULLENRICH', `seats=${c.bold(contact.headcount)} hq=${contact.hq_city} (${contact.hq_country}) via ${enrichment.source} in ${Date.now() - t0}ms`);
  await onStage('fullenrich', { contact, source: enrichment.source });
  await sleep(pace);

  const savings = savingsDelta({ seats: contact.headcount, upliftPct: parseUpliftPct(signal.text) });
  say('CARGO', `delta math: ${savings.seats} seats × 12 × ($${savings.list_per_seat_month.toFixed(2)} × ${1 + savings.uplift_pct / 100} − $${savings.target_per_seat_month.toFixed(2)}) = ${c.bold(formatUsd(savings.annual_savings))}/yr`);
  const { markdown } = composeDraft({ signal, contact, savings, now });
  say('CARGO', `markdown draft composed (${markdown.length} bytes), handing to Nenya`);
  await onStage('cargo', { savings });
  await sleep(pace);

  const verdict = evaluate({ markdown, signal, contact, optIn, now });
  for (const r of verdict.rules) {
    say('NENYA', `${r.ok ? c.green('✓') : c.red('✗')} ${r.id.padEnd(19)} ${c.dim(r.detail)}`);
  }

  await onStage('guardrails', { verdict });
  // The sink is always called; it writes only when Nenya authorized these exact bytes.
  const sink = saveEmailDraft({ markdown, verdict, now });
  if (sink.status === 'DRAFT_SAVED') {
    say('NENYA', c.greenBold('PASS → write authorized'));
    say('SINK', `${c.greenBold(sink.status)} ${c.bold(sink.file)}`);
  } else {
    say('NENYA', `${c.redBold(verdict.decision)} reason: ${c.bold(verdict.reason)}`);
    say('SINK', `${c.red(sink.status)}: zero disk write, routed to logs/nenya-audit.jsonl`);
  }

  await onStage('sink', { sink });

  appendAudit({
    at: verdict.evaluated_at,
    fixture: fixtureId ?? null,
    domain: verdict.domain,
    decision: verdict.decision,
    reason: verdict.reason,
    policy_version: verdict.policy_version,
    failed_rules: verdict.rules.filter((r) => !r.ok).map((r) => r.id),
    enrichment_source: enrichment.source,
    draft_sha256: verdict.draft_sha256,
    file: sink.file ?? null,
  });

  return { signal, contact, enrichment_source: enrichment.source, savings, verdict, sink, markdown };
}
