# Vampire Renewal Raider: runbook

Hand this file to Google Antigravity (or any coding agent) together with the unzipped folder, and ask it to "follow RUNBOOK.md". Every step is a shell command with a check you can see. Part A runs fully offline. Parts B and C add live FullEnrich and Cargo.

## What it does

An r/salesforce renewal complaint becomes a lead. FullEnrich resolves the company and contact. Cargo computes the migration savings and writes a Markdown email draft. Nenya, a deterministic guardrail, checks the draft and writes it to `emailReplies/YYYY-MM-DD_HH-mm-ss.md` only if every rule passes. Nothing is ever sent.

The three built-in fixtures always give the same results:

| Fixture | Domain | Result |
|---|---|---|
| A | apexcloud.io (140 seats, US) | `PASS`, a draft file with savings of $184,800/yr |
| B | microagency.co (6 seats) | `ABORT_POLICY_VIOLATION`, `seats < 20`, no file |
| C | berlinscale.de (Germany) | `ABORT_COMPLIANCE_HOLD`, `GDPR_unsolicited_cold`, no file |

## Part A: run it locally (2 minutes, no accounts)

Requires Node.js 20 or newer (`node --version`). The project has no npm dependencies, so there is no `npm install`.

```bash
cd vampire-renewal-raider
npm test            # expect: 3 pass, 0 fail
npm run reset       # emailReplies/ holds only 2026-10-29_16-45-00.md (the benchmark draft)
npm run demo        # A passes and writes a file; B and C are blocked
ls -lt emailReplies/
```

Check: `npm run demo` ends with `1 draft(s) written, 2 blocked before disk` and exits 0. `logs/nenya-audit.jsonl` has one line per fixture.

For the presentation, use two terminals side by side:
- Right: `npm run watch` prints each new draft as it lands.
- Left: `npm run demo:a`, then `npm run demo:b`, then `npm run demo:c`.

## Part B: live FullEnrich (optional)

```bash
echo 'FULLENRICH_API_KEY=<key from app.fullenrich.com → API>' > .env
set -a; . ./.env; set +a
npm run demo:a
```

Check: the FullEnrich log lines show `company/lookup` and `people/search` calls. The fixture domains have no FullEnrich records, so the run reports `via cached` and uses the fixture's contact. Lookups that find nothing cost 0 credits. To enrich a real company, edit `domain` and `company_name` in `src/fixtures.js`.

## Part C: run it inside Cargo

The Cargo tool is defined in code in `cargo-project/infra/raider.ts`. It has five steps: Start, then FullEnrich `lookupCompany`, then a Script node (the savings math and the draft), then an HTTP Call to this service's `/sink` (where the Nenya check and the file write happen), then End. `cargo-project/infra/raider-waterfall.ts` deploys a second tool, `vampire_renewal_raider_waterfall`, that adds FullEnrich `searchPeople` and `findEmail`; it takes about 90 s a run. Run it with `CARGO_WORKFLOW_UUID=<its workflowUuid>`.

1. Install the Cargo CLI and sign in:
   ```bash
   npm install -g @cargo-ai/cli
   cargo-ai login --oauth        # open the printed URL and press Confirm
   cargo-ai whoami               # must show your workspace
   ```
2. Install the project dependencies and deploy the HTTP connector first. The tool needs the connector's uuid, so the tool file is moved aside for this step:
   ```bash
   cd cargo-project
   npm install
   mv infra/raider.ts /tmp/raider.ts
   npx cargo-ai project deploy --yes
   mv /tmp/raider.ts infra/raider.ts
   ```
3. Point the tool at your workspace's connectors and deploy it:
   ```bash
   cargo-ai connection connector list | grep -iE 'full_enrich|raider_http'   # note both uuids
   export CARGO_FULLENRICH_CONNECTOR_UUID=<FullEnrich uuid>
   export CARGO_HTTP_CONNECTOR_UUID=<raider_http uuid>
   npx cargo-ai project deploy --yes
   cargo-ai orchestration tool list | grep -A3 vampire     # note workflowUuid
   export CARGO_WORKFLOW_UUID=<workflowUuid>
   cd ..
   ```
   If your workspace has no FullEnrich connector, add one in Cargo under Connectors, using Cargo credits or your own key.
4. Give Cargo a public URL for this service. This step needs `cloudflared` (`brew install cloudflared` on macOS; see Cloudflare's docs for other systems):
   ```bash
   scripts/tunnel.sh       # prints RAIDER_TOKEN=... and PUBLIC URL: https://....trycloudflare.com
   ```
   Leave it running. If your machine's DNS can't resolve the new hostname yet, wait about 30 seconds.
5. In a second terminal, run the fixtures through Cargo:
   ```bash
   SINK_URL=<PUBLIC URL> RAIDER_TOKEN=<token> node scripts/cargo-trigger.js A,B,C
   ```
   Check: every run reports `success`. Only A creates a new file in `emailReplies/`. B and C come back with their abort codes and write no file. Each run appears in Cargo under Traces.

Each restart of `tunnel.sh` creates a new URL and a new token. Pass the new values to `cargo-trigger.js`; you don't need to redeploy, because the URL and token are inputs on every run. The token is visible in Cargo's run records, so treat it as specific to this demo.

## Fallback during a live pitch

`npm run reset` always leaves `emailReplies/2026-10-29_16-45-00.md`. Keep it open in a tab. If Wi-Fi stalls, switch to it.

## Files

- `src/`: the pipeline (`fixtures`, `fullenrich`, `math`, `draft`, `nenya`, `sink`, `pipeline`)
- `server.js`: the HTTP API (`/ingest`, `/compose`, `/sink`, `/drafts`, `/fixtures`, `/health`)
- `scripts/`: `demo`, `watch`, `reset`, `fallback`, `tunnel.sh`, `cargo-trigger`
- `cargo/script-node.js`: the Script node source; a test checks it matches `src/`
- `cargo-project/`: the Cargo tool and connector, defined in code
- `README.md`: the rules, the savings formula and the 180-second demo script
