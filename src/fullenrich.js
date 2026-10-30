// FullEnrich waterfall (API v2). Live when FULLENRICH_API_KEY is set; otherwise, or on timeout/error,
// the fixture's cached resolution answers so the demo never stalls on venue Wi-Fi.
//   company/lookup  (sync)  -> headcount + HQ
//   people/search   (sync)  -> VP RevOps / Head of IT at the domain
//   contact/enrich/bulk (async, 30-90s typical) -> verified work email, polled with forceResults until timeout
const BASE = process.env.FULLENRICH_BASE_URL ?? 'https://app.fullenrich.com/api/v2';
const TARGET_TITLES = ['VP RevOps', 'VP Revenue Operations', 'Head of Revenue Operations', 'Head of IT', 'CIO', 'Founder'];

async function call(method, route, body, key) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(Number(process.env.FULLENRICH_HTTP_TIMEOUT_MS ?? 6000)),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`FullEnrich ${method} ${route} -> ${res.status} ${json?.code ?? json?.message ?? ''}`), { status: res.status, json });
  return json;
}

async function liveResolve(signal, key, log) {
  const out = {};
  const company = (await call('POST', '/company/lookup', { domain: signal.domain }, key)).companies?.[0];
  if (company) {
    const hq = company.locations?.headquarters ?? {};
    if (company.headcount > 0) out.headcount = company.headcount;
    if (hq.country_code) out.hq_country = String(hq.country_code).toUpperCase();
    if (hq.city) out.hq_city = [hq.city, hq.region].filter(Boolean).join(', ');
    log(`company/lookup ${signal.domain}: headcount=${company.headcount ?? '?'} (${company.headcount_range ?? 'n/a'}) hq=${hq.country_code ?? '?'}`);
  }
  const people = (await call('POST', '/people/search', {
    current_company_domains: [{ value: signal.domain, exact_match: true }],
    current_position_titles: TARGET_TITLES.map((value) => ({ value, exact_match: false })),
    limit: 1,
  }, key)).people ?? [];
  const person = people[0];
  if (!person) return out;
  const first = person.first_name ?? person.firstname;
  const last = person.last_name ?? person.lastname;
  const linkedin = person.social_profiles?.professional_network?.url ?? person.linkedin_url;
  const title = person.employment?.current?.title ?? person.title;
  Object.assign(out, { first_name: first, last_name: last, title, linkedin_url: linkedin });
  log(`people/search ${signal.domain}: ${first} ${last}, ${title}`);

  const { enrichment_id: id } = await call('POST', '/contact/enrich/bulk', {
    name: `raider-${signal.domain}-${Date.now()}`,
    data: [{ first_name: first, last_name: last, domain: signal.domain, company_name: signal.company_name, linkedin_url: linkedin, enrich_fields: ['contact.work_emails'] }],
  }, key);
  const deadline = Date.now() + Number(process.env.FULLENRICH_EMAIL_TIMEOUT_MS ?? 8000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const result = await call('GET', `/contact/enrich/bulk/${id}?forceResults=true`, null, key);
      const email = result.data?.[0]?.contact_info?.most_probable_work_email;
      if (email?.email) {
        Object.assign(out, { email: email.email, email_status: email.status });
        return out;
      }
      if (['CANCELED', 'CREDITS_INSUFFICIENT', 'RATE_LIMIT', 'UNKNOWN'].includes(result.status)) break;
    } catch (err) {
      if (err.status !== 400) throw err;
    }
  }
  log(`contact/enrich ${id}: email still in waterfall after timeout`);
  return out;
}

export async function resolveContact({ signal, cached, log = () => {} }) {
  const key = process.env.FULLENRICH_API_KEY;
  if (!key || process.env.FULLENRICH_MODE === 'cached') {
    return { contact: { ...cached }, source: 'cached', live_fields: [] };
  }
  try {
    const live = Object.fromEntries(Object.entries(await liveResolve(signal, key, log)).filter(([, v]) => v != null && v !== ''));
    // A live person without a live email must not borrow the cached person's email.
    const personSwapped = live.first_name && (live.first_name !== cached?.first_name || live.last_name !== cached?.last_name);
    const merged = { ...(cached ?? {}), ...live };
    if (personSwapped && !live.email) Object.assign(merged, { email: undefined, email_status: 'PENDING' });
    return { contact: merged, source: Object.keys(live).length ? 'live' : 'cached', live_fields: Object.keys(live) };
  } catch (err) {
    log(`live call failed (${err.message}); using cached resolution`);
    return { contact: { ...cached }, source: 'cached', live_fields: [], error: err.message };
  }
}
