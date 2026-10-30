// Right-hand pane: live view of emailReplies/, prints each new draft as it lands.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('emailReplies');
fs.mkdirSync(dir, { recursive: true });
const seen = new Set(fs.readdirSync(dir));
const list = () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse();
  console.log(`\nemailReplies/ (${files.length})\n${files.map((f) => `  ${f}`).join('\n') || '  (empty)'}`);
};
list();
setInterval(() => {
  for (const name of fs.readdirSync(dir)) {
    if (seen.has(name)) continue;
    seen.add(name);
    console.log(`\n\x1b[1;32m+ NEW DRAFT emailReplies/${name}\x1b[0m\n`);
    console.log(fs.readFileSync(path.join(dir, name), 'utf8'));
    list();
  }
}, 400);
