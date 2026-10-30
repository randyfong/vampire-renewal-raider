// Pencils-down reset: archive old test drafts and logs, leave only the benchmark file in emailReplies/.
import fs from 'node:fs';
import path from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const archive = path.resolve('.archive', stamp);
let moved = 0;
for (const dir of ['emailReplies', 'logs']) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    fs.mkdirSync(path.join(archive, dir), { recursive: true });
    fs.renameSync(path.join(dir, name), path.join(archive, dir, name));
    moved += 1;
  }
}
fs.mkdirSync('emailReplies', { recursive: true });
fs.mkdirSync('logs', { recursive: true });
for (const name of fs.existsSync('fallback') ? fs.readdirSync('fallback').filter((n) => n.endsWith('.md')) : []) {
  fs.copyFileSync(path.join('fallback', name), path.join('emailReplies', name));
}
fs.accessSync('emailReplies', fs.constants.W_OK);
console.log(`archived ${moved} file(s) to ${path.relative(process.cwd(), archive)}; emailReplies/ holds: ${fs.readdirSync('emailReplies').join(', ') || '(empty)'}`);
