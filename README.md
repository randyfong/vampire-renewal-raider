# Vampire Renewal Raider

Autonomous churn-capture agent: an r/salesforce renewal complaint goes through FullEnrich, then Cargo, then the Nenya guardrail, and ends as a dated Markdown draft in `emailReplies/`. Nothing is sent. Nenya blocks the disk write when any rule fails, and every decision lands in `logs/nenya-audit.jsonl`.

Node 20+, zero npm dependencies.

```bash
npm test            # 3 tests: A writes, B/C blocked, tamper/forgery refused, Cargo script parity
npm run demo        # Fixtures A, B, C with presenter pacing (--pace 0 for instant)
npm run watch       # right pane: prints each new draft as it lands
npm run reset       # pencils-down: archive old runs + logs, leave only the benchmark draft
npm run fallback    # rebuild fallback/2026-10-29_16-45-00.md (hot fallback) and copy to emailReplies/
npm start           # HTTP service on :8787 (RAIDER_TOKEN=... to require x-raider-token)
scripts/tunnel.sh   # service + Cloudflare quick tunnel; prints public URL + token for Cargo
```

## Fixture outcomes (verified)

| Fixture | Domain | FullEnrich | Nenya | Disk |
|---|---|---|---|---|
| A Happy Path | apexcloud.io | 140 seats, VP RevOps, Austin US | `PASS` | `emailReplies/YYYY-MM-DD_HH-mm-ss.md`, $184,800/yr |
| B Policy Fail 1 | microagency.co | 6 seats, Founder, Denver US | `ABORT_POLICY_VIOLATION` `seats < 20` | none, audit only |
| C Policy Fail 2 | berlinscale.de | 210 seats, Head of IT, Berlin DE | `ABORT_COMPLIANCE_HOLD` `GDPR_unsolicited_cold` | none, audit only |

Savings formula (`src/math.js`, integer cents): `seats × 12 × (list × (1 + uplift) − target)` with list $165.00, target $84.70, uplift parsed from the signal (default 18%). Fixture A: 140 × 12 × ($194.70 − $84.70) = **$184,800**.

## Nenya ruleset (`src/nenya.js`, policy `nenya.gtm-outbound/1.0.0`)

Deterministic: `threshold_check` (seats ≥ 20), `jurisdiction_fence` (US/CA; EU/EEA/UK without opt-in → `GDPR_unsolicited_cold`), `exclusion_sync` (`data/exclusions.json`), `verified_contact` (deliverable email, recipient matches enrichment).
Grounding: `zero_hallucination` (source snippet cited verbatim; every % claimed appears in the source), `mathematical_truth` (every $ figure equals the audited recompute), `tone_check` (no pressure/hype phrases, `!` or shouting in our own words; the quoted prospect text is exempt), `draft_state` (YAML frontmatter, required keys, `status: QUEUED_FOR_REVIEW`).

Bypass-proof sink: `saveEmailDraft` writes only with a verdict object the engine itself issued, `PASS`, whose SHA-256 matches the exact bytes being written. A copied or forged verdict, or a draft edited after evaluation, is refused (covered by `npm test`). Over HTTP, `/sink` always runs Nenya itself; callers cannot pass a verdict in.

## FullEnrich

Set `FULLENRICH_API_KEY` for live mode (API v2): `company/lookup` (headcount, HQ) and `people/search` (VP RevOps / Head of IT at the domain) are synchronous. Then `contact/enrich/bulk` runs and is polled with `forceResults` for up to `FULLENRICH_EMAIL_TIMEOUT_MS` (default 8000). Live fields override the cached fixture resolution. On timeout or error the cached resolution answers and the log says `via cached`. FullEnrich's email waterfall typically takes 30–90 s, so the 3-second live moment belongs on the Cargo canvas or with a pre-warmed contact. `FULLENRICH_MODE=cached` forces offline.

## Cargo

The Cargo tool `vampire_renewal_raider` is defined in code in `cargo-project/infra/raider.ts`. Its steps are Start, FullEnrich `lookupCompany`, a Script node (`cargo/script-node.js`: savings math and draft), an HTTP Call to `/sink?soft=1` (the Nenya check and the file write), then End. Deploy it with `cargo-ai project deploy --yes`, then run it:

```bash
scripts/tunnel.sh                                                    # terminal 1: service + public URL + token
SINK_URL=<public url> RAIDER_TOKEN=<token> node scripts/cargo-trigger.js A,B,C   # terminal 2
```

A second tool, `vampire_renewal_raider_waterfall` (`infra/raider-waterfall.ts`), adds FullEnrich `searchPeople` and `findEmail`, the full waterfall. It takes about 90 seconds a run because of FullEnrich's email step, so use the fast tool live and point to the waterfall tool's trace. All three runs end in `success`. A writes a draft; B and C come back with their abort codes and write no file. Runs appear in Cargo under Traces. To set this up in a new workspace, follow RUNBOOK.md Part C.

## 180-second run (split screen: left = Cargo + terminal, right = `npm run watch`)

| Time | Do | Say |
|---|---|---|
| 0:00–0:35 | Show Fixture A JSON (`curl localhost:8787/fixtures` or `src/fixtures.js`) | "Built solo in 4 hours vibe coding with Antigravity. Here's an r/salesforce complaint: an 18% renewal hike." |
| 0:35–1:15 | Cargo canvas run (or `npm run demo:a`) | "Cargo ingests the signal, FullEnrich resolves the VP RevOps, and the delta comes out at exactly $184,800 a year." |
| 1:15–2:05 | `npm run demo:b` then `demo:c` | "Nenya keeps this agent steerable: A passes, B is rejected live. Zero junk files reach the outbound queue." |
| 2:05–2:40 | Right pane shows the new draft; `ls -lt emailReplies/` | "No automated blast. The agent writes a dated Markdown draft for review." |
| 2:40–3:00 | This README's table | "Cargo orchestrates, FullEnrich is the data truth, Nenya is the deterministic guardrail." |

Hot fallback: `emailReplies/2026-10-29_16-45-00.md` is always present after `npm run reset`. Line: "While the live waterfall finishes over the room Wi-Fi, here is the exact validated draft written to disk moments ago."

## Pencils down (T-15)

- [ ] `npm run reset`: archives old runs; `emailReplies/` writable and holds only the benchmark draft
- [ ] `npm test` green
- [ ] `scripts/tunnel.sh` running if Cargo calls `/sink`; URL + token pasted into Cargo
- [ ] Timer at 2:45; hotspot on
