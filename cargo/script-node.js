// Cargo Script node "delta_math": paste this whole file into the node's JavaScript editor.
// Plain JS, no require. Reads upstream nodes, returns { savings, contact, signal, markdown } for the nenya_sink HTTP node.
// Only the INPUT MAPPING block depends on your node slugs and the FullEnrich action output shape;
// run the tool once in Test mode and adjust those paths if a field comes back undefined.

// ---- INPUT MAPPING ----
const start = nodes.start;
// Cargo slugs connector nodes by integration: FullEnrich (lookupCompany), FullEnrich_2 (searchPeople), FullEnrich_3 (findEmail).
const first = (out, listKey) => {
  if (!out) return {};
  const list = out[listKey] || out.results || out.items || out.data;
  return (Array.isArray(list) ? list[0] : out) || {};
};
const company = first(nodes.fullenrich_company || nodes.FullEnrich, 'companies');
const person = first(nodes.fullenrich_person || nodes.FullEnrich_2, 'people');
const email = nodes.fullenrich_email || nodes.FullEnrich_3 || {};

const signal = {
  platform: 'reddit',
  community: start.community || 'r/salesforce',
  source_url: start.source_url || 'https://www.reddit.com/r/salesforce/',
  text: start.text,
  domain: start.domain,
  company_name: start.company_name,
};
const hq = (company.locations && company.locations.headquarters) || {};
const contact = {
  first_name: person.first_name || start.first_name,
  last_name: person.last_name || start.last_name,
  title: person.title || (person.employment && person.employment.current && person.employment.current.title) || start.title,
  email: email.most_probable_email || start.email,
  email_status: email.most_probable_email_status || start.email_status,
  headcount: Number(company.headcount || start.headcount),
  hq_city: [hq.city, hq.region].filter(Boolean).join(', ') || start.hq_city,
  hq_country: String(hq.country_code || start.hq_country || '').toUpperCase(),
};
// ---- END INPUT MAPPING ----

// Audited formula (identical to src/math.js): seats × 12 × (list × (1 + uplift) − target), integer cents.
const LIST_CENTS = 16500;
const TARGET_CENTS = 8470;
const pctMatch = String(signal.text).match(/(\d+(?:\.\d+)?)\s*%/);
const upliftPct = pctMatch ? Number(pctMatch[1]) : 18;
const upliftedCents = Math.round((LIST_CENTS * (100 + upliftPct)) / 100);
const perSeatDeltaCents = upliftedCents - TARGET_CENTS;
const annual = Math.round((contact.headcount * 12 * perSeatDeltaCents) / 100);
const usd = (n) => '$' + Number(n).toLocaleString('en-US');
const savings = {
  seats: contact.headcount,
  uplift_pct: upliftPct,
  uplift_source: pctMatch ? 'signal' : 'default',
  per_seat_month_delta: perSeatDeltaCents / 100,
  annual_savings: annual,
  formula: 'seats × 12 × (list × (1 + uplift) − target)',
};

// Markdown draft (identical layout to src/draft.js, which Nenya's grounding rules check).
const q = (v) => JSON.stringify(String(v == null ? '' : v));
const frontmatter = [
  'to: ' + q(contact.email),
  'name: ' + q(contact.first_name + ' ' + contact.last_name),
  'title: ' + q(contact.title),
  'company: ' + q(signal.company_name),
  'domain: ' + q(signal.domain),
  'hq_country: ' + q(contact.hq_country),
  'headcount: ' + contact.headcount,
  'source_signal: ' + q(signal.source_url),
  'source_snippet: ' + q(signal.text),
  'uplift_pct: ' + upliftPct,
  'savings_delta: ' + q(usd(annual)),
  'savings_formula: ' + q(savings.formula),
  'status: ' + q('QUEUED_FOR_REVIEW'),
  'generated_at: ' + q(new Date().toISOString()),
].join('\n');
const body = [
  '# Subject: Facing that ' + (pctMatch ? upliftPct + '% ' : '') + 'Salesforce renewal spike at ' + signal.company_name + '?',
  '',
  'Hi ' + contact.first_name + ',',
  '',
  "Saw your team's comment on " + signal.community + ':',
  '',
  '> ' + signal.text,
  '',
  'For a team of ~' + contact.headcount + ' seats, that bump represents roughly ' + usd(annual) + '/yr in unallocated overhead.',
  'We engineered a zero-downtime migration path that protects your workflows while cutting per-seat costs back to sustainable tiers.',
  '',
  'Worth a brief look at the numbers before your contract locks in?',
  '',
  'Best regards,',
  'GTM Inbound Operations',
  '',
].join('\n');

const markdown = '---\n' + frontmatter + '\n---\n\n' + body;
// sink_body is the ready-made JSON for the nenya_sink HTTP node (body format: Text).
return { signal, contact, savings, markdown, sink_body: JSON.stringify({ signal, contact, markdown }) };
