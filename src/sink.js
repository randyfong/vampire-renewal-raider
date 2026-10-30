// Markdown file sink: emailReplies/YYYY-MM-DD_HH-mm-ss.md. Refuses any write Nenya did not authorize.
import fs from 'node:fs';
import path from 'node:path';
import { authorizesWrite } from './nenya.js';

const pad = (n) => String(n).padStart(2, '0');

export function draftFilename(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.md`;
}

export function saveEmailDraft({ markdown, verdict, now = new Date(), dir = path.resolve(process.cwd(), 'emailReplies') }) {
  if (!authorizesWrite(verdict, markdown)) {
    return { status: 'WRITE_REFUSED', reason: verdict?.decision ?? 'no Nenya verdict' };
  }
  fs.mkdirSync(dir, { recursive: true });
  const base = draftFilename(now).replace(/\.md$/, '');
  for (let n = 0; n < 100; n += 1) {
    const filename = n === 0 ? `${base}.md` : `${base}_${n + 1}.md`;
    try {
      fs.writeFileSync(path.join(dir, filename), markdown, { encoding: 'utf8', flag: 'wx' });
      return { status: 'DRAFT_SAVED', file: path.join(path.basename(dir), filename) };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`could not allocate a draft filename for ${base}`);
}
