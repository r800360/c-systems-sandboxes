/* Sandbox for mycpp: runs the real C program (WebAssembly) and steps its
 * state handlers through the exported api_* functions. */
(async function () {
  'use strict';
  const { $, h, enc, dec, run, instance, load, inlineSvg, gvIndex, visible, debounce, store } = CSys;
  const NAMES = ['START', 'FORWARDSLASH', 'LINECOMMENT', 'BLOCKCOMMENT', 'STAR',
                 'DOUBLEQUOTE', 'BACKSLASHDOUBLE', 'SINGLEQUOTE', 'BACKSLASHSINGLE'];
  const [START, FSLASH, LINE, BLOCK, STAR, DQ, DQESC, SQ, SQESC] = NAMES.keys();
  const WASM = 'mycpp.wasm';
  const MAX_TRACE = 20000;

  const PRESETS = {
    'Typical C file': `#include <stdio.h>
/* Print a greeting.
 * Comments vanish; line numbers do not. */
int main(void)
{
    printf("// not a comment, /* nor this */\\n"); // trailing comment
    char q = '\\''; /* escaped quote in a char */
    return 0; /* done */
}
`,
    'Tricky slashes': `x = a / b;            // division, not a comment
y = a /*inline*/ / b; // comment between operands
s = "/*";             // comment opener inside a string
c = '/';              // slash inside a char
path = a/"b";         // slash right before a string
end = 1 /
`,
    'Unterminated comment': `int x = 1;
/* this comment
   never ends
int y = 2;
`,
    'Literals and escapes': `"a \\" quote" /* gone */ 'b'
"ends with backslash \\\\" // gone
'\\'' /* x */ "\\\\" // y
"multi
line string" /* z */
`,
  };

  const src = $('#src'), out = $('#out'), err = $('#err'), status = $('#status');
  const preset = $('#preset');
  for (const k of Object.keys(PRESETS)) preset.append(h('option', { value: k }, k));
  preset.value = store.get('preset', 'Typical C file');
  src.value = PRESETS[preset.value] || PRESETS['Typical C file'];

  const factory = await load('mycpp.js', 'createMycpp');
  const stepper = await instance(factory, WASM);
  const svg = await inlineSvg('states.svg', $('#diagram'));
  const gv = gvIndex(svg);

  /* ---------- run the real program ---------- */
  async function runMain(text) {
    const t0 = performance.now();
    const r = await run(factory, { stdin: text, progname: 'mycpp', wasmUrl: WASM });
    const ms = performance.now() - t0;
    const o = dec(r.stdout);
    const errText = dec(r.stderr);
    const bad = errText.match(/line (\d+)/);
    const lines = o.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();          // trailing newline
    out.replaceChildren(...lines.map((line, i) =>
      h('span', { class: 'l' + (bad && +bad[1] === i + 1 ? ' err' : '') }, line || ' ')));
    status.textContent = 'exit ' + r.status;
    status.className = 'status ' + (r.status === 0 ? 'ok' : 'bad');
    err.hidden = !errText;
    err.textContent = errText ? 'stderr: ' + errText : '';
    const inB = enc(text).length;
    $('#stats').textContent = `${inB} bytes in → ${r.stdout.length} bytes out · ` +
      `${text.split('\n').length - 1} newlines in, ${o.split('\n').length - 1} out · ran in ${ms.toFixed(1)} ms`;
  }

  /* ---------- trace every byte through the handlers ---------- */
  let trace = [], final = null;
  function traceAll(text) {
    const bytes = enc(text).slice(0, MAX_TRACE);
    stepper._api_reset();
    trace = [];
    let state = START;
    for (const b of bytes) {
      const line = stepper._api_line();
      const to = stepper._api_step(b);
      const n = stepper._api_out_len();
      const wrote = [];
      for (let i = 0; i < n; i++) wrote.push(stepper._api_out_byte(i));
      trace.push({ b, from: state, to, wrote, line });
      state = to;
    }
    const rc = stepper._api_finish();
    const n = stepper._api_out_len();
    const wrote = [];
    for (let i = 0; i < n; i++) wrote.push(stepper._api_out_byte(i));
    final = { state, rc, wrote, cmtline: stepper._api_cmtline() };
  }

  function roles() {
    const r = trace.map((t) => {
      if ([LINE, BLOCK, STAR].includes(t.to)) return 'comment';
      if (t.from === STAR && t.to === START) return 'comment';
      if (t.from === LINE && t.to === START) return 'code';
      if ([DQ, DQESC].includes(t.to) || (t.from === DQ && t.to === START)) return 'string';
      if ([SQ, SQESC].includes(t.to) || (t.from === SQ && t.to === START)) return 'char';
      if (t.to === FSLASH) return 'pending';
      return 'code';
    });
    for (let i = 0; i < r.length; i++) {
      if (r[i] !== 'pending') continue;
      const nx = trace[i + 1];
      r[i] = nx && (nx.to === LINE || nx.to === BLOCK) ? 'comment' : 'code';
    }
    return r;
  }

  const show = (bytes) => (bytes.length ? JSON.stringify(dec(Uint8Array.from(bytes))) : 'nothing');
  const describe = (t) => `byte ${JSON.stringify(String.fromCharCode(t.b))} (0x${t.b.toString(16).padStart(2, '0')}) on line ${t.line}: ` +
    `${NAMES[t.from]} → ${NAMES[t.to]}, wrote ${show(t.wrote)}`;

  function renderTimeline() {
    const r = roles();
    const tl = $('#timeline');
    const spans = [];
    trace.forEach((t, i) => {
      const ch = t.b === 10 ? '⏎' : t.b === 32 ? '·' : t.b === 9 ? '⇥' : (t.b < 32 || t.b > 126) ? '?' : String.fromCharCode(t.b);
      spans.push(h('span', { class: 'r-' + r[i], 'data-i': i }, ch));
      if (t.b === 10) spans.push(h('span', { style: 'flex-basis:100%;height:0;padding:0;border:0' }));
    });
    tl.replaceChildren(...spans);
    if (trace.length >= MAX_TRACE) tl.append(h('span', { class: 'note' }, ` … (first ${MAX_TRACE} bytes)`));
  }
  $('#timeline').addEventListener('mouseover', (e) => {
    const i = e.target.dataset && e.target.dataset.i;
    if (i !== undefined) $('#hover').textContent = describe(trace[+i]);
  });

  /* ---------- stepper ---------- */
  let k = 0, timer = null;
  function paint() {
    Object.values(gv.nodes).forEach((g) => g.classList.remove('on'));
    Object.values(gv.edges).forEach((g) => g.classList.remove('on'));
    $('#pos').textContent = `byte ${k} / ${trace.length}`;
    const cur = $('#timeline .cur');
    if (cur) cur.classList.remove('cur');
    if (k === 0) {
      gv.nodes.START && gv.nodes.START.classList.add('on');
      $('#sByte').textContent = '–'; $('#sFrom').textContent = 'START'; $('#sTo').textContent = '–';
      $('#sWrote').textContent = '–'; $('#sLine').textContent = '1'; $('#sOut').textContent = '';
      return;
    }
    const t = trace[k - 1];
    const node = gv.nodes[NAMES[t.to]];
    if (node) node.classList.add('on');
    const edge = gv.edges[NAMES[t.from] + '->' + NAMES[t.to]];
    if (edge) edge.classList.add('on');
    const span = $(`#timeline [data-i="${k - 1}"]`);
    if (span) { span.classList.add('cur'); }
    $('#sByte').textContent = t.b === 10 ? '\\n' : t.b === 32 ? '␠' : String.fromCharCode(t.b);
    $('#sFrom').textContent = NAMES[t.from];
    $('#sTo').textContent = NAMES[t.to];
    $('#sWrote').textContent = show(t.wrote);
    $('#sLine').textContent = String(t.line);
    let so = [];
    for (let i = 0; i < k; i++) so = so.concat(trace[i].wrote);
    if (k === trace.length && final) {
      so = so.concat(final.wrote);
      if (final.rc !== 0) $('#sWrote').textContent += `  ·  EOF in ${NAMES[final.state]} → error, comment opened on line ${final.cmtline}`;
      else if (final.wrote.length) $('#sWrote').textContent += '  ·  EOF: flushed held "/"';
    }
    $('#sOut').textContent = visible(Uint8Array.from(so));
  }
  function stop() { clearInterval(timer); timer = null; $('#play').textContent = '▶ Play'; }
  $('#next').onclick = () => { if (k < trace.length) { k++; paint(); } };
  $('#prev').onclick = () => { if (k > 0) { k--; paint(); } };
  $('#reset').onclick = () => { stop(); k = 0; paint(); };
  $('#play').onclick = () => {
    if (timer) return stop();
    $('#play').textContent = '⏸ Pause';
    if (k >= trace.length) k = 0;
    timer = setInterval(() => { if (k >= trace.length) return stop(); k++; paint(); }, 1000 / +$('#speed').value);
  };
  $('#speed').oninput = () => { if (timer) { stop(); $('#play').click(); } };

  const update = debounce(async () => {
    await runMain(src.value);
    traceAll(src.value);
    renderTimeline();
    stop(); k = 0; paint();
  }, 120);
  src.addEventListener('input', update);
  preset.addEventListener('change', () => { src.value = PRESETS[preset.value]; store.set('preset', preset.value); update(); });
  update();
})().catch((e) => {
  document.querySelector('main').prepend(CSys.h('p', { class: 'card status bad' }, 'Failed to start: ' + e.message));
  throw e;
});
