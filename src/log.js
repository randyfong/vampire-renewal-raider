// Presenter-friendly terminal log plus a plain pipeline log on disk.
// Draft filenames and log clocks use the venue's local time (WSL defaults to UTC).
process.env.TZ ??= 'America/Los_Angeles';
import fs from 'node:fs';
import path from 'node:path';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const c = {
  dim: paint('2'), bold: paint('1'), red: paint('31'), green: paint('32'), yellow: paint('33'),
  blue: paint('34'), magenta: paint('35'), cyan: paint('36'), redBold: paint('1;31'), greenBold: paint('1;32'),
};

const TAGS = {
  INGEST: c.cyan('[INGEST]   '),
  FULLENRICH: c.blue('[FULLENRICH]'),
  CARGO: c.magenta('[CARGO]    '),
  NENYA: c.yellow('[NENYA]    '),
  SINK: c.green('[SINK]     '),
};

const LOG_FILE = path.resolve(process.cwd(), 'logs', 'pipeline.log');

export function log(stage, message, { quiet = false } = {}) {
  const stamp = new Date().toISOString();
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, `${stamp} [${stage}] ${message.replace(/\x1b\[[0-9;]*m/g, '')}\n`);
  if (!quiet) console.log(`${c.dim(new Date().toTimeString().slice(0, 8))} ${TAGS[stage] ?? `[${stage}]`} ${message}`);
}
