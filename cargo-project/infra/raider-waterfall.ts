import { defineTool, defineWorkflow } from "@cargo-ai/cdk";
import { connectorRef } from "@cargo-ai/workflow-sdk";
import { z } from "zod";

// Vampire Renewal Raider: intent signal -> FullEnrich (Cargo connector) -> delta math + Markdown draft
// (Script node, generated from ../../cargo/script-node.js) -> Nenya guardrail + file sink (HTTP /sink).
// Connector uuids in the target workspace: `cargo-ai connection connector list`.
// FullEnrich is the workspace's FullEnrich connector; raider_http is deployed by infra/connectors.ts.
const FULLENRICH_CONNECTOR = process.env.CARGO_FULLENRICH_CONNECTOR_UUID ?? "bfac13c1-bc7f-4562-8f42-f87a5f016631";
const HTTP_CONNECTOR = process.env.CARGO_HTTP_CONNECTOR_UUID ?? "e4302735-6098-432c-9f27-329ea209aafe";

const waterfallFlow = defineWorkflow(
  "vampire-renewal-raider-waterfall",
  {
    input: z.object({
      text: z.string(),
      domain: z.string(),
      company_name: z.string(),
      source_url: z.string().optional(),
      community: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      title: z.string().optional(),
      email: z.string().optional(),
      email_status: z.string().optional(),
      headcount: z.number().optional(),
      hq_city: z.string().optional(),
      hq_country: z.string().optional(),
      sink_url: z.string(),
      sink_token: z.string(),
    }),
    output: z.object({ annual_savings: z.number(), markdown: z.string(), nenya: z.any() }),
    uses: {
      fullenrich: connectorRef(FULLENRICH_CONNECTOR, "FullEnrich"),
      http: connectorRef(HTTP_CONNECTOR, "http"),
    },
  },
  ({ input, uses, js }) => {
    const fullenrich_company = uses.fullenrich.lookupCompany({ domain: input.domain });
    const fullenrich_person = uses.fullenrich.searchPeople({
      companyInfo: { domain_or: [input.domain] },
      jobRole: { title_or: ["VP RevOps", "VP Revenue Operations", "Head of Revenue Operations", "Head of IT"] },
      limit: 1,
    });
    const fullenrich_email = uses.fullenrich.findEmail({
      firstName: input.first_name,
      lastName: input.last_name,
      domainName: input.domain,
      companyName: input.company_name,
    });
    const delta_math = js(({ nodes }) => {
      const start = nodes.start;
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
      return { signal, contact, savings, markdown, sink_body: JSON.stringify({ signal, contact, markdown }) };
    });
    const nenya_sink = uses.http.call({
      url: `${input.sink_url}/sink?soft=1`,
      method: "post",
      headers: [{ key: "x-raider-token", value: input.sink_token }, { key: "content-type", value: "application/json" }],
      bodyFormat: "json",
      bodyJson: delta_math.sink_body,
    });
    return { annual_savings: delta_math.savings.annual_savings, markdown: delta_math.markdown, nenya: nenya_sink };
  },
);

export const raiderWaterfall = defineTool("vampire_renewal_raider_waterfall", {
  workflow: waterfallFlow,
  description: "Full FullEnrich waterfall (company, people search, email). Churn-capture: r/salesforce renewal signal -> FullEnrich -> savings delta + Markdown draft -> Nenya guardrail -> emailReplies/*.md",
  emojiSlug: "bat",
});
