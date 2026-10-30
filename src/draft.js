// Cargo composition step: enriched lead + savings math -> Markdown email draft with YAML frontmatter.
import { formatUsd } from './math.js';

export const REQUIRED_FRONTMATTER = [
  'to', 'name', 'title', 'company', 'domain', 'hq_country', 'headcount',
  'source_signal', 'source_snippet', 'uplift_pct', 'savings_delta', 'status', 'generated_at',
];

const yamlString = (value) => JSON.stringify(String(value ?? ''));

export function composeDraft({ signal, contact, savings, now = new Date() }) {
  const upliftClaim = savings.uplift_source === 'signal' ? `${savings.uplift_pct}% ` : '';
  const frontmatter = {
    to: contact.email,
    name: `${contact.first_name} ${contact.last_name}`,
    title: contact.title,
    company: signal.company_name,
    domain: signal.domain,
    hq_country: contact.hq_country,
    headcount: contact.headcount,
    source_signal: signal.source_url,
    source_snippet: signal.text,
    uplift_pct: savings.uplift_pct,
    savings_delta: formatUsd(savings.annual_savings),
    savings_formula: savings.formula,
    status: 'QUEUED_FOR_REVIEW',
    generated_at: now.toISOString(),
  };
  const header = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${typeof value === 'number' ? value : yamlString(value)}`)
    .join('\n');

  const body = [
    `# Subject: Facing that ${upliftClaim}Salesforce renewal spike at ${signal.company_name}?`,
    '',
    `Hi ${contact.first_name},`,
    '',
    `Saw your team's comment on ${signal.community}:`,
    '',
    `> ${signal.text}`,
    '',
    `For a team of ~${contact.headcount} seats, that bump represents roughly ${formatUsd(savings.annual_savings)}/yr in unallocated overhead.`,
    'We engineered a zero-downtime migration path that protects your workflows while cutting per-seat costs back to sustainable tiers.',
    '',
    'Worth a brief look at the numbers before your contract locks in?',
    '',
    'Best regards,',
    'GTM Inbound Operations',
    '',
  ].join('\n');

  return { frontmatter, markdown: `---\n${header}\n---\n\n${body}` };
}

export function parseFrontmatter(markdown) {
  const match = String(markdown ?? '').match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) return null;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    try {
      fields[key] = JSON.parse(raw);
    } catch {
      fields[key] = raw;
    }
  }
  return { fields, body: markdown.slice(match[0].length) };
}
