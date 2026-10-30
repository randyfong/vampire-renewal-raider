// Pre-staged ingest queue for judging: no dependence on live social scraping.
// `resolution` is the cached FullEnrich answer used when the live API is off or slow.
export const FIXTURES = {
  A: {
    id: 'A',
    label: 'Happy Path',
    signal: {
      platform: 'reddit',
      community: 'r/salesforce',
      source_url: 'https://www.reddit.com/r/salesforce/',
      text: 'Salesforce renewal came back 18% higher with forced Agentforce bundles. Looking to migrate.',
      domain: 'apexcloud.io',
      company_name: 'ApexCloud',
    },
    resolution: {
      first_name: 'Jordan',
      last_name: 'Reyes',
      title: 'VP RevOps',
      email: 'jordan.reyes@apexcloud.io',
      email_status: 'DELIVERABLE',
      linkedin_url: 'https://www.linkedin.com/in/jordan-reyes-revops',
      headcount: 140,
      hq_city: 'Austin, TX',
      hq_country: 'US',
    },
    expected: 'PASS',
  },
  B: {
    id: 'B',
    label: 'Policy Fail 1',
    signal: {
      platform: 'reddit',
      community: 'r/salesforce',
      source_url: 'https://www.reddit.com/r/salesforce/',
      text: 'Burned by license reduction policy. Trying to cut 4 seats and per-seat cost jumped.',
      domain: 'microagency.co',
      company_name: 'MicroAgency',
    },
    resolution: {
      first_name: 'Sam',
      last_name: 'Patel',
      title: 'Founder / Principal',
      email: 'sam@microagency.co',
      email_status: 'DELIVERABLE',
      linkedin_url: 'https://www.linkedin.com/in/sam-patel-microagency',
      headcount: 6,
      hq_city: 'Denver, CO',
      hq_country: 'US',
    },
    expected: 'ABORT_POLICY_VIOLATION',
  },
  C: {
    id: 'C',
    label: 'Policy Fail 2',
    signal: {
      platform: 'reddit',
      community: 'r/salesforce',
      source_url: 'https://www.reddit.com/r/salesforce/',
      text: 'Mandatory enterprise tier switch in EMEA is forcing a vendor review across our stack.',
      domain: 'berlinscale.de',
      company_name: 'BerlinScale',
    },
    resolution: {
      first_name: 'Lena',
      last_name: 'Vogel',
      title: 'Head of IT',
      email: 'lena.vogel@berlinscale.de',
      email_status: 'DELIVERABLE',
      linkedin_url: 'https://www.linkedin.com/in/lena-vogel-berlinscale',
      headcount: 210,
      hq_city: 'Berlin',
      hq_country: 'DE',
    },
    expected: 'ABORT_COMPLIANCE_HOLD',
  },
  D: {
    id: 'D', label: 'Active customer',
    signal: { platform: 'reddit', community: 'r/salesforce', source_url: 'https://www.reddit.com/r/salesforce/', text: 'Our Salesforce renewal is up 18%. Reviewing migration options.', domain: 'tidewaterhq.com', company_name: 'Tidewater' },
    resolution: { first_name: 'Alex', last_name: 'Morgan', title: 'Head of IT', email: 'alex@tidewaterhq.com', email_status: 'DELIVERABLE', headcount: 120, hq_city: 'Seattle, WA', hq_country: 'US' },
    expected: 'ABORT_EXCLUSION_MATCH',
  },
};

export function getFixture(id) {
  const fixture = FIXTURES[String(id).toUpperCase()];
  if (!fixture) throw new Error(`unknown fixture ${id}; expected one of ${Object.keys(FIXTURES).join(', ')}`);
  return fixture;
}
