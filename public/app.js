const $ = (id) => document.getElementById(id);
const names = { A: 'ApexCloud', B: 'MicroAgency', C: 'BerlinScale', D: 'Tidewater' };
const stages = ['ingest', 'fullenrich', 'cargo', 'guardrails', 'sink'];
let busy = false;
const headers = () => ({ 'Content-Type': 'application/json', ...($('token').value ? { 'x-raider-token': $('token').value } : {}) });
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const empty = $('email').innerHTML;
function clear() {
  $('run-title').textContent = 'The crypt is quiet.';
  $('http').textContent = 'Awaiting a lead';
  $('outcome').textContent = 'Choose your next victim.';
  $('outcome').className = '';
  $('detail').textContent = 'Press 1–4 or select a coffin to run a lead through the pipeline.';
  $('fill').style.width = '0';
  document.querySelector('.blood').setAttribute('aria-valuenow', '0');
  document.querySelectorAll('#stages li').forEach((el) => el.className = '');
  document.querySelectorAll('.coffin').forEach((el) => { el.classList.remove('selected'); el.setAttribute('aria-pressed', 'false'); });
  $('rules').replaceChildren(); $('email').innerHTML = empty;
  $('draft-state').textContent = 'No draft yet'; $('error').textContent = '';
}
function lock(value) { busy = value; document.querySelectorAll('button').forEach((el) => el.disabled = value); }
function stage(event) {
  const index = stages.indexOf(event.stage);
  if (index < 0) return;
  $('fill').style.width = `${(index + 1) * 20}%`;
  document.querySelector('.blood').setAttribute('aria-valuenow', index + 1);
  document.querySelectorAll('#stages li').forEach((el, i) => el.classList.toggle('done', i <= index));
  if (event.stage === 'fullenrich') $('detail').textContent = `${event.contact.first_name} ${event.contact.last_name} · ${event.contact.headcount} seats · ${event.contact.hq_country} · FullEnrich ${event.source}`;
  if (event.stage === 'cargo') {
    $('outcome').className = 'savings';
    $('outcome').innerHTML = `${escape(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(event.savings.annual_savings))}<small> /yr</small>`;
    $('detail').textContent = `Potential annual savings · ${event.savings.seats} seats. Awaiting guardrails.`;
  }
  if (event.stage === 'guardrails') {
    $('rules').innerHTML = event.verdict.rules.map((r) => `<div class="rule ${r.ok ? '' : 'fail'}">${r.ok ? '✓' : '✕'} ${escape(r.id.replaceAll('_', ' '))}${r.ok ? '' : `: ${escape(r.detail)}`}</div>`).join('');
    if (event.verdict.decision !== 'PASS') { $('outcome').className = ''; $('outcome').textContent = 'Warded off.'; $('detail').textContent = event.verdict.reason; }
  }
}
function renderDraft(result) {
  // Render the pipeline's constrained Markdown vocabulary, escaping all source text.
  const body = result.markdown.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const html = body.split(/\n\n+/).map((part) => part.startsWith('# ') ? `<h3>${escape(part.slice(2))}</h3>` : part.startsWith('> ') ? `<blockquote>${escape(part.slice(2))}</blockquote>` : `<p>${escape(part).replaceAll('\n', '<br>')}</p>`).join('');
  $('email').innerHTML = `<div class="recipient">To: ${escape(result.contact.email)}</div>${html}`;
}
async function run(id) {
  if (busy) return;
  clear(); lock(true);
  document.querySelector(`[data-id="${id}"]`).classList.add('selected');
  document.querySelector(`[data-id="${id}"]`).setAttribute('aria-pressed', 'true');
  $('run-title').textContent = `Hunting ${names[id]}`; $('http').textContent = 'Pipeline running';
  $('outcome').textContent = 'Unearthing the lead…';
  const runId = crypto.randomUUID();
  const controller = new AbortController();
  let reading;
  try {
    const response = await fetch(`/demo/events?run=${runId}`, { headers: headers(), signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).error);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    // Receiving the ready event guarantees registration before starting the run.
    const first = await reader.read(); pending += decoder.decode(first.value, { stream: true });
    reading = (async () => {
      for (;;) {
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1); if (line) stage(JSON.parse(line)); }
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
      }
    })();
    const resultResponse = await fetch(`/demo/run?run=${runId}`, { method: 'POST', headers: headers(), body: JSON.stringify({ fixture: id }) });
    const result = await resultResponse.json();
    if (!result.verdict) throw new Error(result.error || 'Pipeline did not return a verdict');
    await reading;
    $('http').textContent = `HTTP ${resultResponse.status} · ${result.verdict.decision === 'PASS' ? 'Approved' : 'Blocked'}`;
    $('run-title').textContent = `${names[id]} · hunt complete`;
    if (result.verdict.decision === 'PASS') {
      $('detail').textContent = `Annual savings verified. ${result.sink.file} · queued for human review.`;
      $('draft-state').textContent = 'Queued for review'; renderDraft(result);
    } else {
      $('detail').textContent = result.verdict.reason;
      $('draft-state').textContent = 'Write refused';
      $('email').innerHTML = '<div class="empty"><span aria-hidden="true">✝</span><p>Nenya blocked this lead.<br>No draft written. No outreach sent.</p></div>';
    }
  } catch (error) { $('error').textContent = error.message; $('http').textContent = 'Run failed'; }
  finally { controller.abort(); if (reading) await reading.catch(() => {}); lock(false); }
}
async function reset() {
  if (busy) return;
  lock(true);
  try { const response = await fetch('/demo/reset', { method: 'POST', headers: headers() }); if (!response.ok) throw new Error((await response.json()).error); clear(); }
  catch (error) { $('error').textContent = error.message; }
  finally { lock(false); }
}
document.querySelectorAll('.coffin').forEach((button) => button.addEventListener('click', () => run(button.dataset.id)));
$('reset').addEventListener('click', reset);
document.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  const id = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' }[event.key];
  if (id) { event.preventDefault(); run(id); }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); }
});
clear();
