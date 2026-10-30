// Builds the hot-fallback benchmark draft (Fixture A through the real pipeline with a pinned clock)
// at fallback/2026-10-29_16-45-00.md and copies it into emailReplies/.
import '../src/log.js';
import fs from 'node:fs';
import path from 'node:path';
import { composeDraft } from '../src/draft.js';
import { getFixture } from '../src/fixtures.js';
import { parseUpliftPct, savingsDelta } from '../src/math.js';
import { evaluate } from '../src/nenya.js';
import { saveEmailDraft } from '../src/sink.js';

const now = new Date(2026, 9, 29, 16, 45, 0);
const { signal, resolution: contact } = getFixture('A');
const savings = savingsDelta({ seats: contact.headcount, upliftPct: parseUpliftPct(signal.text) });
const { markdown } = composeDraft({ signal, contact, savings, now });
const verdict = evaluate({ markdown, signal, contact, now });
if (verdict.decision !== 'PASS') throw new Error(`benchmark draft failed Nenya: ${verdict.decision}`);

const dir = path.resolve(process.cwd(), 'fallback');
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.md')) : []) fs.rmSync(path.join(dir, f));
const saved = saveEmailDraft({ markdown, verdict, now, dir });
fs.mkdirSync('emailReplies', { recursive: true });
fs.copyFileSync(path.join(dir, path.basename(saved.file)), path.join('emailReplies', path.basename(saved.file)));
console.log(`benchmark draft: ${saved.file} (copied to emailReplies/)`);
