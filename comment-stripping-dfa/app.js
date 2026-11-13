/* Sandbox for the table-driven DFA: steps the real C engine (api_feed) and
 * replays its minimization (api_minimize) round by round. */
(async function () {
  'use strict';
  const { $, $$, h, enc, dec, instance, load, inlineSvg, gvIndex, visible, debounce } = CSys;
  const CLS = ['/', '*', '"', "'", '\\', '\\n', 'other'];
  const ACT = ['-', 'emit', 'space', "'/'+emit"];
  const EOF = ['accept', "emit '/' then accept", 'error: unterminated comment'];
  const classify = (c) => ({ 47: 0, 42: 1, 34: 2, 39: 3, 92: 4, 10: 5 }[c] ?? 6);
  const PALETTE = ['#cfe0ff', '#ffe1b8', '#c9f0d8', '#f3d1f4', '#d9d4ff', '#ffd3d3', '#d0f0f4', '#f1f0c4', '#e3e3e3', '#ffcfe6'];

  const factory = await load('dfastrip.js', 'createDfastrip');
  const api = await instance(factory, 'dfastrip.wasm');
  const tables = [await (await fetch('dfa.json')).json(), await (await fetch('dfa-v1.json')).json()];
  const svgUrls = ['dfa.svg', 'dfa-v1.svg'];

  let v = 0;            // 0 minimal, 1 first design
  let gv = null;
  let trace = [], eofInfo = null, k = 0, timer = null;
  const input = $('#input');
  input.value = 'a/b; "/*s*/" /* c\n */ // d\nx';

  async function loadMachine() {
    const svg = await inlineSvg(svgUrls[v], $('#diagram'));
    gv = gvIndex(svg);
    renderTable();
    retrace();
  }

  function retrace() {
    const bytes = enc(input.value).slice(0, 2000);
    api._api_init(v);
    trace = [];
    for (const b of bytes) {
      const from = api._api_state();
      const r = api._api_feed(b);
      const n = r & 255;
      const wrote = n ? [(r >> 8) & 255, (r >> 16) & 255].slice(0, n) : [];
      trace.push({ b, from, to: api._api_state(), wrote, cls: classify(b) });
    }
    const f = api._api_finish();
    eofInfo = { state: api._api_state(), act: f & 255, wrote: (f >> 8) & 255 ? [(f >> 16) & 255] : [], line: api._api_cmt_line() };
    stop(); k = 0;
    renderTape(); paint();
  }

  function renderTape() {
    $('#tape').replaceChildren(...trace.map((t, i) =>
      h('span', { 'data-i': i }, t.b === 10 ? '\\n' : t.b === 32 ? '␠' : String.fromCharCode(t.b))));
  }

  function renderTable() {
    const T = tables[v];
    const head = h('tr', {}, h('th', {}, 'state'), CLS.map((c) => h('th', {}, c)), h('th', {}, 'EOF'));
    const rows = T.states.map((name, s) => h('tr', { 'data-s': s }, h('th', {}, name),
      T.delta[s].map(([nx, a], c) => h('td', { 'data-c': c }, T.states[nx] + (a ? ' / ' + ACT[a] : ''))),
      h('td', {}, EOF[T.eof[s]])));
    $('#tt').replaceChildren(head, ...rows);
  }

  function paint() {
    const T = tables[v];
    Object.values(gv.nodes).forEach((g) => g.classList.remove('on'));
    Object.values(gv.edges).forEach((g) => g.classList.remove('on'));
    $$('#tt td.on').forEach((td) => td.classList.remove('on'));
    $$('#tt tr.row-on').forEach((tr) => tr.classList.remove('row-on'));
    $$('#tape span').forEach((s, i) => { s.className = i < k - 1 ? 'done' : i === k - 1 ? 'cur' : ''; });
    $('#pos').textContent = `byte ${k} / ${trace.length}`;
    let out = [];
    for (let i = 0; i < k; i++) out = out.concat(trace[i].wrote);
    if (k === 0) {
      const g = gv.nodes[T.states[0]]; if (g) g.classList.add('on');
      $('#vByte').textContent = '–'; $('#vClass').textContent = ''; $('#vEdge').textContent = 'start in ' + T.states[0];
      $('#vAct').textContent = '–'; $('#vEof').textContent = '–';
    } else {
      const t = trace[k - 1];
      const g = gv.nodes[T.states[t.to]]; if (g) g.classList.add('on');
      const e = gv.edges[T.states[t.from] + '->' + T.states[t.to]]; if (e) e.classList.add('on');
      const row = $(`#tt tr[data-s="${t.from}"]`);
      if (row) { row.classList.add('row-on'); const td = row.querySelector(`td[data-c="${t.cls}"]`); if (td) td.classList.add('on'); }
      $('#vByte').textContent = t.b === 10 ? '\\n' : t.b === 32 ? '␠' : String.fromCharCode(t.b);
      $('#vClass').textContent = 'class ' + CLS[t.cls];
      $('#vEdge').textContent = `${T.states[t.from]} → ${T.states[t.to]}`;
      $('#vAct').textContent = ACT[T.delta[t.from][t.cls][1]] + (t.wrote.length ? ` → ${JSON.stringify(dec(Uint8Array.from(t.wrote)))}` : '');
      if (k === trace.length) {
        out = out.concat(eofInfo.wrote);
        $('#vEof').textContent = EOF[eofInfo.act] + (eofInfo.act === 2 ? ` (opened on line ${eofInfo.line})` : '');
      } else $('#vEof').textContent = '–';
    }
    $('#vOut').textContent = visible(Uint8Array.from(out));
  }

  function stop() { clearInterval(timer); timer = null; $('#play').textContent = '▶ Play'; }
  $('#next').onclick = () => { if (k < trace.length) { k++; paint(); } };
  $('#prev').onclick = () => { if (k > 0) { k--; paint(); } };
  $('#reset').onclick = () => { stop(); k = 0; paint(); };
  $('#play').onclick = () => {
    if (timer) return stop();
    if (k >= trace.length) k = 0;
    $('#play').textContent = '⏸ Pause';
    timer = setInterval(() => { if (k >= trace.length) return stop(); k++; paint(); }, 1000 / +$('#speed').value);
  };
  input.addEventListener('input', debounce(retrace, 150));
  $$('#machine button').forEach((b) => b.onclick = () => {
    $$('#machine button').forEach((x) => x.classList.toggle('on', x === b));
    v = +b.dataset.v; loadMachine();
  });

  /* ---- minimization replay from the C implementation ---- */
  function renderMin(mv) {
    const T = tables[mv];
    const k2 = api._api_minimize(mv);
    const R = api._api_rounds();
    const head = h('tr', {}, h('th', {}, 'state'), Array.from({ length: R }, (_, r) => h('th', {}, r === 0 ? 'outputs' : 'round ' + r)));
    const rows = T.states.map((name, s) => h('tr', {}, h('th', {}, name), Array.from({ length: R }, (_, r) => {
      const g = api._api_group(r, s);
      return h('td', { class: 'g', style: `background:${PALETTE[g % PALETTE.length]}` }, 'G' + g);
    })));
    $('#groups').replaceChildren(head, ...rows);
    const groups = {};
    T.states.forEach((name, s) => { const g = api._api_group(R - 1, s); (groups[g] = groups[g] || []).push(name); });
    $('#minSummary').textContent = `${T.states.length} states → ${k2} groups after ${R - 1} refinement round(s): ` +
      Object.values(groups).map((g) => '{' + g.join(', ') + '}').join(' ');
  }
  $$('#minMachine button').forEach((b) => b.onclick = () => {
    $$('#minMachine button').forEach((x) => x.classList.toggle('on', x === b));
    renderMin(+b.dataset.v);
  });

  await loadMachine();
  renderMin(1);
})().catch((e) => {
  document.querySelector('main').prepend(CSys.h('p', { class: 'card status bad' }, 'Failed to start: ' + e.message));
  throw e;
});
