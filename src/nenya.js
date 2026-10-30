// Nenya guardrail engine: deterministic, non-bypassable policy over every draft before any disk write.
// Every evaluation is appended to the audit log, pass or abort.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, REQUIRED_FRONTMATTER } from './draft.js';
import { formatUsd, parseUpliftPct, savingsDelta } from './math.js';

export const POLICY_VERSION = 'nenya.gtm-outbound/1.0.0';
export const MIN_SEATS = 20;
export const ALLOWED_COUNTRIES = new Set(['US', 'CA']);
const GDPR_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB',
]);

const issued = new WeakSet();

export function loadExclusions(file = path.resolve(process.cwd(), 'data', 'exclusions.json')) {
  if (!fs.existsSync(file)) return { active_pipeline: [], customers: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function rule(id, group, ok, detail, abort) {
  return { id, group, ok, detail, ...(ok ? {} : { abort }) };
}

export function evaluate({ markdown, signal, contact, optIn = false, exclusions = loadExclusions(), now = new Date() }) {
  const country = String(contact.hq_country ?? '').toUpperCase();
  const domain = String(signal.domain ?? '').toLowerCase();
  const parsed = parseFrontmatter(markdown);
  const fm = parsed?.fields ?? {};
  const body = parsed?.body ?? '';

  const truth = savingsDelta({ seats: contact.headcount, upliftPct: parseUpliftPct(signal.text) });
  const truthUsd = formatUsd(truth.annual_savings);
  const bodyFigures = body.match(/\$[\d,]+(?:\.\d+)?/g) ?? [];
  const claimedPcts = (body.match(/\d+(?:\.\d+)?\s*%/g) ?? []).map((p) => p.replace(/\s/g, ''));
  const snippetPcts = (String(signal.text).match(/\d+(?:\.\d+)?\s*%/g) ?? []).map((p) => p.replace(/\s/g, ''));
  const exclusionHit = (exclusions.active_pipeline ?? []).includes(domain) ? 'active_pipeline'
    : (exclusions.customers ?? []).includes(domain) ? 'customers' : null;
  const ownWords = body.split(String(signal.text)).join(" ");
  const toneHit = ownWords.match(/\b(act now|limited time|guaranteed?|urgent|last chance|click here|risk[- ]free|free money)\b|!/i)?.[0]
    ?? ownWords.match(/\b[A-Z]{4,}\b/)?.[0] ?? null;
  const missingKeys = REQUIRED_FRONTMATTER.filter((key) => fm[key] === undefined || fm[key] === '');

  let jurisdiction;
  if (ALLOWED_COUNTRIES.has(country)) {
    jurisdiction = rule('jurisdiction_fence', 'deterministic', true, `hq_country=${country} in allowlist US/CA`);
  } else if (GDPR_COUNTRIES.has(country)) {
    jurisdiction = optIn
      ? rule('jurisdiction_fence', 'deterministic', true, `hq_country=${country} with recorded opt-in`)
      : rule('jurisdiction_fence', 'deterministic', false, `hq_country=${country} is GDPR scope, no opt-in`,
        { code: 'ABORT_COMPLIANCE_HOLD', reason: 'GDPR_unsolicited_cold' });
  } else {
    jurisdiction = rule('jurisdiction_fence', 'deterministic', false, `hq_country=${country || 'unknown'} not in allowlist`,
      { code: 'ABORT_COMPLIANCE_HOLD', reason: 'jurisdiction_not_allowlisted' });
  }

  const rules = [
    rule('threshold_check', 'deterministic', Number(contact.headcount) >= MIN_SEATS,
      `seats=${contact.headcount} (min ${MIN_SEATS})`,
      { code: 'ABORT_POLICY_VIOLATION', reason: `seats < ${MIN_SEATS}` }),
    jurisdiction,
    rule('exclusion_sync', 'deterministic', !exclusionHit,
      exclusionHit ? `${domain} matches ${exclusionHit}` : `${domain} not in active pipeline or customer list`,
      { code: 'ABORT_EXCLUSION_MATCH', reason: `domain_in_${exclusionHit}` }),
    rule('verified_contact', 'deterministic',
      ['DELIVERABLE', 'VERIFIED', 'VALID'].includes(String(contact.email_status).toUpperCase()) && fm.to === contact.email,
      `to=${fm.to ?? 'missing'} status=${contact.email_status}`,
      { code: 'ABORT_POLICY_VIOLATION', reason: 'unverified_or_mismatched_recipient' }),
    rule('zero_hallucination', 'grounding',
      fm.source_snippet === signal.text && body.includes(signal.text) && claimedPcts.every((p) => snippetPcts.includes(p)),
      `source snippet cited verbatim; claimed % ${claimedPcts.join(',') || 'none'} ⊆ source % ${snippetPcts.join(',') || 'none'}`,
      { code: 'ABORT_GROUNDING_FAILURE', reason: 'uncited_or_invented_claim' }),
    rule('mathematical_truth', 'grounding',
      fm.savings_delta === truthUsd && Number(fm.headcount) === Number(contact.headcount)
        && bodyFigures.length > 0 && bodyFigures.every((fig) => fig === truthUsd),
      `audited ${truth.formula} = ${truthUsd}; draft says ${fm.savings_delta ?? 'missing'}`,
      { code: 'ABORT_GROUNDING_FAILURE', reason: 'savings_delta_mismatch' }),
    rule('tone_check', 'grounding', toneHit === null,
      toneHit ? `pressure/spam marker "${toneHit}"` : 'no pressure, hype or shouting markers',
      { code: 'ABORT_TONE_VIOLATION', reason: 'aggressive_or_spam_tone' }),
    rule('draft_state', 'grounding',
      parsed !== null && missingKeys.length === 0 && fm.status === 'QUEUED_FOR_REVIEW',
      parsed ? (missingKeys.length ? `missing frontmatter: ${missingKeys.join(', ')}` : `frontmatter valid, status=${fm.status}`) : 'no YAML frontmatter',
      { code: 'ABORT_DRAFT_STATE', reason: 'invalid_frontmatter' }),
  ];

  const failed = rules.filter((r) => !r.ok);
  const verdict = Object.freeze({
    decision: failed.length ? failed[0].abort.code : 'PASS',
    reason: failed.length ? failed[0].abort.reason : 'all rules passed',
    policy_version: POLICY_VERSION,
    domain,
    rules,
    audited_savings: truth.annual_savings,
    draft_sha256: sha256(markdown),
    evaluated_at: now.toISOString(),
  });
  issued.add(verdict);
  return verdict;
}

// The sink accepts only verdicts this engine issued, for the exact bytes it evaluated.
export function authorizesWrite(verdict, markdown) {
  return issued.has(verdict) && verdict.decision === 'PASS' && verdict.draft_sha256 === sha256(markdown);
}

export function appendAudit(entry, file = path.resolve(process.cwd(), 'logs', 'nenya-audit.jsonl')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}
