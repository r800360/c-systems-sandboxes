/* Stack corruption sandbox. Everything shown comes from data.json, which CI
 * produced by building and running the program on each platform, except the
 * "Run it" panel, which runs the same WebAssembly files live. */
(async function () {
  'use strict';
  const { $, h, sleep } = CSys;
  const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  const D = await (await fetch('data.json')).json();
  const P = D.platforms;
  const PLATS = [['x86-64', 'x86-64'], ['arm64', 'arm64'], ['arm32', 'ARM32'], ['wasm', 'WebAssembly']].filter(([k]) => P[k]);
  const PNAME = Object.fromEntries(PLATS);
  const BUG = { null: 'NULL store', oob: 'off-by-one', fixed: 'fixed' };
  const WORD = { caught: 'caught', ok: 'clean', crash: 'crash', trap: 'trap', corrupt: 'corrupted', silent: 'missed', vanished: 'code deleted', other: '?' };
  const TIP = {
    caught: 'a tool or check reported the bug', ok: 'correct output, nothing reported',
    crash: 'killed by the OS (SIGSEGV), no explanation', trap: 'the compiler turned the UB into a trap instruction',
    corrupt: 'ran to the end with wrong data', silent: 'no symptom at all: the bug went unnoticed',
    vanished: 'the optimizer deleted code because of the UB', other: 'unexpected',
  };
  const chip = (v) => h('span', { class: 'v ' + (v || 'na'), title: TIP[v] || '' }, v ? WORD[v] : '—');
  const cell = (plat, row, bug) => (((P[plat] || {}).rows || {})[row] || {})[bug];

  // ---------------------------------------------------------------- listing
  const src = D.source.replace(/\n$/, '').split('\n');
  const body0 = src.findIndex((l) => l.startsWith('#include'));
  $('#listing').append(h('pre', { class: 'code' }, src.map((line, i) => {
    if (i < body0) return null;
    let cls = '';
    if (/^\s*\*j = 0;/.test(line) || /i <= LEN/.test(line)) cls = 'bug';
    else if (/i < LEN; i\+\+\)$/.test(line) && /#else/.test(src[i - 1] || '')) cls = 'fix';
    else if (/^#(ifdef|else|endif)/.test(line)) cls = 'dir';
    return h('div', { class: cls }, h('span', { class: 'ln' }, String(i + 1)), line || ' ');
  })));

  // ------------------------------------------------------------------ facts
  const fact = (cond, ...kids) => (cond ? h('li', {}, ...kids) : null);
  const c = (plat, row, bug) => cell(plat, row, bug) || {};
  const clangGone = c('x86-64', 'clang-O2', 'null');
  $('#facts').append(...[
    fact(c('arm32', 'O0-plain', 'oob').verdict === 'corrupt', chip('corrupt'), ' ARM32, gcc -O0, no stack protector: ', h('code', {}, 'b[4]'), ' is ', h('code', {}, 'a'), ', so the program prints ', h('code', {}, 'a: 5'), '. This is the classic symptom.'),
    fact(c('arm32', 'O0-default', 'oob').verdict === 'caught', chip('caught'), ' ARM32 with the default stack protector: ', h('code', {}, 'b[4]'), ' is the canary, so the program aborts with "stack smashing detected".'),
    fact(c('x86-64', 'O0-plain', 'oob').verdict === 'silent', chip('silent'), ' x86-64: ', h('code', {}, 'b[4]'), ' is alignment padding. Nothing reads it, so there is no symptom, but the bug is still there.'),
    fact(c('arm64', 'clang-O0', 'oob').verdict === 'corrupt' && c('arm64', 'O0-plain', 'oob').verdict === 'silent', chip('corrupt'), ' arm64: the compiler decides. gcc leaves padding at ', h('code', {}, 'b[4]'), '; clang puts ', h('code', {}, 'a'), ' there and prints ', h('code', {}, 'a: 5'), '.'),
    fact(c('wasm', 'O0-plain', 'null').verdict === 'silent', chip('silent'), ' WebAssembly: address 0 is ordinary memory, so ', h('code', {}, '*j = 0'), ' simply succeeds. Emscripten\'s debug build plants a marker at address 0 and checks it at exit.'),
    fact(clangGone.verdict === 'vanished', chip('vanished'), ' clang -O2: the NULL store makes the whole call path undefined, so ', h('code', {}, 'main'), ' compiles to nothing. It prints nothing and exits with status ', (clangGone.status || '').replace('exit ', ''), '.'),
    fact(PLATS.every(([p]) => p === 'arm32' || c(p, 'asan', 'oob').verdict === 'caught'), chip('caught'), ' Only AddressSanitizer reports the off-by-one everywhere it runs, and only below -O2: clang -O2 optimizes the access away before ASan can check it. Valgrind, UBSan and every static analyzer miss it.'),
  ].filter(Boolean));
  let fixedOk = 0, fixedAll = 0, builds = 0;
  for (const [name, p] of Object.entries(P)) {
    for (const r of Object.values(p.rows)) {
      if (r.fixed) { fixedAll++; if (r.fixed.verdict === 'ok') fixedOk++; }
      if (name !== 'static') builds += ['fixed', 'null', 'oob'].filter((b) => r[b]).length;
    }
  }
  $('#nbuilds').textContent = String(builds);
  $('#fixednote').textContent = `The fixed program is clean in ${fixedOk} of ${fixedAll} builds and analyses: every compiler, sanitizer, Valgrind run, gdb session and analyzer, on every platform.`;

  // ----------------------------------------------------------------- frames
  const frames = [];
  for (const [p, name] of PLATS) for (const f of (P[p].frames || [])) frames.push({ ...f, plat: p, pname: name });
  const blocks = (f) => {
    const out = [];
    for (const s of f.slots) {
      const base = s.name.replace(/ \(high half\)$/, '');
      const last = out[out.length - 1];
      if (last && last.high && last.name === base) { last.off = s.off; last.size = 8; last.high = false; continue; }
      out.push({ off: s.off, size: 4, kind: s.kind, name: base, high: base !== s.name });
    }
    return out;
  };
  const WHY = {
    unused: 'The stray write lands in padding (or a compiler temporary) that nothing reads afterwards. The output looks right; the bug is only waiting for a different layout.',
    local: 'The compiler put a directly above the array, with no gap, so b[4] is a. It silently becomes 5.',
    canary: 'With -fstack-protector the compiler places arrays right below a random guard word and checks it before main returns. b[4] overwrites the guard, the check fails, __stack_chk_fail aborts with "stack smashing detected".',
    fp: 'b[4] overwrites the saved frame pointer: the caller would run with a corrupted frame after main returns.',
    ret: 'b[4] overwrites the return address: main would return to an attacker-shaped address.',
    saved: 'b[4] overwrites a saved register that the caller expects to be preserved.',
  };
  const PLATWHY = {
    'x86-64': 'x86-64 System V ABI: a local array of 16 bytes or more is 16-byte aligned, which leaves room above b.',
    arm64: 'AArch64: gcc stores the frame record (saved x29, x30) at the bottom of the frame, below the locals; clang stores it at the top and packs a directly above b. Same CPU, different layout.',
    arm32: 'ARM AAPCS needs only 4-byte alignment for an int array, so neighbours sit right next to b.',
    wasm: 'clang\'s wasm32 target also aligns the 16-byte array to 16. The frame lives in linear memory, on the shadow stack.',
  };
  // open on the most telling layout: ARM32, where b[4] is a
  let curFrame = Math.max(0, frames.findIndex((f) => f.plat === 'arm32' && f.b4_kind === 'local')), animating = false;
  function drawFrame() {
    const f = frames[curFrame];
    const bl = blocks(f);
    const kids = [h('div', { class: 'sep' }, 'high addresses (toward the caller)')];
    for (const b of bl) {
      const covers16 = b.off <= 16 && 16 < b.off + b.size;
      kids.push(h('div', { class: 'off' }, (b.off >= 0 ? 'b+' : 'b') + b.off),
        h('div', { class: `slot ${b.kind}`, 'data-off': b.off, style: b.size === 8 ? 'min-height:44px' : null },
          h('span', {}, b.name), h('span', { class: 'val' }, b.kind === 'local' ? '1' : '')),
        h('div', { class: 'ann' }, covers16 ? h('b', {}, '← b[4] lands here') : (b.name === 'b[0]' ? '← b, passed to sub()' : '')));
    }
    kids.push(h('div', { class: 'sep' }, `low addresses (toward sp) · ${f.ptr * 8}-bit pointers`));
    $('#frame').replaceChildren(...kids);
    put($('#framewhy'),
      h('p', { class: 'lead', style: 'margin-top:0' }, h('b', {}, `${f.pname}, ${f.label}: `), 'b[4] is ', h('b', {}, f.b4), '.'),
      h('p', { class: 'note' }, WHY[f.b4_kind] || ''),
      h('p', { class: 'note' }, PLATWHY[f.plat] || ''));
    const o = cell(f.plat, f.row, 'oob');
    $('#outcome').className = 'outcome';
    put($('#outcome'), h('div', {}, h('b', {}, 'What the -DBUG_OOB build did: '), o ? chip(o.verdict) : '—', ' ', o ? o.summary : 'not measured'),
      o && o.stdout ? h('div', { class: 'note mono', style: 'margin-top:4px;white-space:pre-wrap' }, o.stdout.trim().split('\n').slice(-1)[0]) : null);
    $('#framecmd').textContent = `Captured from: ${f.cmd} (gdb stopped in main just before sub(b) is called).`;
    $('#loopstate').textContent = '';
  }
  $('#framepick').append(...frames.map((f, i) => h('button', { class: 'chip' + (i === curFrame ? ' on' : ''), onclick: (e) => {
    if (animating) return;
    curFrame = i; drawFrame();
    $('#framepick').querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.target.classList.add('on');
  } }, `${f.pname}: ${f.label}`)));
  if (frames.length) drawFrame();
  $('#animate').addEventListener('click', async () => {
    if (animating || !frames.length) return;
    animating = true; drawFrame();
    for (let i = 0; i <= 4; i++) {
      const target = [...$('#frame').querySelectorAll('.slot')].find((el) => {
        const off = +el.dataset.off, size = el.style.minHeight ? 8 : 4;
        return off <= 4 * i && 4 * i < off + size;
      });
      $('#loopstate').textContent = `i = ${i}: b[${i}] = 5` + (i === 4 ? '  (i <= LEN is still true)' : '');
      if (target) {
        target.querySelector('.val').textContent = '5';
        if (i === 4) target.classList.add('hit');
        target.animate([{ transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 300 });
      }
      await sleep(i === 4 ? 0 : 550);
    }
    $('#outcome').animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 500 });
    animating = false;
  });

  // ----------------------------------------------------------------- matrix
  $('#legend').append(...['caught', 'crash', 'trap', 'corrupt', 'silent', 'vanished'].map((v) => h('span', {}, chip(v), ' ', TIP[v])));
  let selected = null;
  function showDetail(title, x, tr) {
    if (selected) selected.classList.remove('sel');
    selected = tr; if (tr) tr.classList.add('sel');
    put($('#detail'),
      h('div', { class: 'sub' }, title, '  ', chip(x.verdict)),
      h('div', {}, x.summary),
      h('div', { class: 'note mono', style: 'margin:6px 0' }, '$ ', x.cmd, x.status ? `   → ${x.status}` : ''),
      x.report ? h('pre', { class: 'out' }, x.report) : null,
      x.stdout && !x.report ? h('pre', { class: 'out' }, x.stdout) : null);
  }
  const head1 = h('tr', {}, h('th', { class: 'row' }, ''), PLATS.map(([, n]) => h('th', { class: 'plat', colspan: 2 }, n)));
  const head2 = h('tr', {}, h('th', { class: 'row' }, 'build / tool'), PLATS.map(() => [h('th', { class: 'plat' }, 'NULL'), h('th', {}, 'OOB')]));
  const body = [];
  for (const [row, label] of D.rows) {
    if (!PLATS.some(([p]) => cell(p, row, 'null'))) continue;
    const tr = h('tr', {});
    tr.append(h('td', { class: 'row' }, label));
    for (const [p, pname] of PLATS) {
      ['null', 'oob'].forEach((bug, k) => {
        const x = cell(p, row, bug);
        tr.append(h('td', { class: k === 0 ? 'first' : '' }, x
          ? h('button', { title: x.summary, onclick: () => showDetail(`${pname} · ${label} · ${BUG[bug]}`, x, tr) }, chip(x.verdict))
          : chip(null)));
      });
    }
    body.push(tr);
  }
  $('#matrix').append(h('thead', {}, head1, head2), h('tbody', {}, body));
  if (P.static) {
    const S = P.static.rows;
    const rows = D.static_rows.filter(([r]) => S[r]).map(([r, label]) => {
      const tr = h('tr', {}, h('td', { class: 'row mono' }, label));
      for (const bug of ['null', 'oob', 'fixed']) {
        const x = S[r][bug];
        tr.append(h('td', {}, h('button', { title: x.summary, onclick: () => showDetail(`${label} · ${BUG[bug]}`, x, tr) }, chip(x.verdict))));
      }
      return tr;
    });
    $('#static').append(h('thead', {}, h('tr', {}, h('th', { class: 'row' }, 'analyzer'), h('th', {}, 'NULL store'), h('th', {}, 'off-by-one'), h('th', {}, 'fixed program'))), h('tbody', {}, rows));
  }
  const first = cell('arm32', 'O0-plain', 'oob') ? ['arm32', 'O0-plain', 'oob'] : [PLATS[0][0], 'asan', 'oob'];
  const fx = cell(...first);
  if (fx) showDetail(`${PNAME[first[0]]} · ${Object.fromEntries(D.rows)[first[1]]} · ${BUG[first[2]]}`, fx, null);

  // -------------------------------------------------------- run in browser
  const W = (P.wasm || {}).rows || {};
  let bug = 'oob', wrow = 'O0-plain';
  const ROWLABEL = { 'O0-plain': '-O0', 'O0-default': '-O0 + assertions', 'clang-O2': '-O2', asan: 'ASan', 'asan-O2': 'ASan -O2', ubsan: 'UBSan', safeheap: 'SAFE_HEAP' };
  $('#pickbug').append(...['fixed', 'null', 'oob'].map((b) => h('button', { class: b === bug ? 'on' : '', onclick: (e) => {
    bug = b; $('#pickbug').querySelectorAll('button').forEach((x) => x.classList.remove('on')); e.target.classList.add('on'); showCi();
  } }, BUG[b])));
  $('#pickrow').append(...D.wasm_rows.filter((r) => W[r]).map((r) => h('button', { class: 'chip' + (r === wrow ? ' on' : ''), title: (W[r].fixed || {}).cmd, onclick: (e) => {
    wrow = r; $('#pickrow').querySelectorAll('button').forEach((x) => x.classList.remove('on')); e.target.classList.add('on'); showCi();
  } }, ROWLABEL[r] || r)));
  function showCi() {
    const x = W[wrow] && W[wrow][bug];
    put($('#runci'), x ? ['CI saw: ', chip(x.verdict), ' ', x.summary] : []);
  }
  showCi();
  const hex = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
  function memView(fr) {
    const nameAt = (addr) => {
      if (addr === fr.a) return 'a';
      if (addr >= fr.b && addr < fr.b + 16) return `b[${(addr - fr.b) / 4}]`;
      if (addr === fr.b + 16) return 'b[4]?';
      return '';
    };
    const row = (lbl, vals, other) => h('div', { class: 'memrow' }, h('span', { class: 'lbl' }, lbl), vals.map((v, i) => {
      const addr = fr.lo + 4 * i, n = nameAt(addr);
      const inB = n.startsWith('b[') && n !== 'b[4]?';
      const cls = ['cell', v !== other[i] ? (inB ? 'wrote' : 'chg') : '', n === 'a' ? 'isa' : '', inB ? 'isb' : ''].join(' ');
      return h('div', { class: cls, title: hex(addr) }, h('span', { class: 'a' }, n || `b${addr - fr.b >= 0 ? '+' : ''}${addr - fr.b}`), v > 0xffff ? hex(v).slice(0, 6) + '…' : String(v));
    }));
    const zrow = (lbl, vals, other) => h('div', { class: 'memrow' }, h('span', { class: 'lbl' }, lbl), vals.map((v, i) =>
      h('div', { class: 'cell' + (v !== other[i] ? ' chg' : '') }, h('span', { class: 'a' }, '0x' + (4 * i).toString(16).padStart(2, '0')), hex(v))));
    const ascii = (v) => String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255).replace(/[^\x20-\x7e]/g, '·');
    return h('div', {},
      h('div', { class: 'sub' }, 'Linear memory around main\'s frame (word values, before and after sub() runs)'),
      row('before', fr.before, fr.before), row('after', fr.after, fr.before),
      fr.complete ? null : h('p', { class: 'note' }, 'The program stopped inside sub(), before the "after" snapshot.'),
      h('div', { class: 'sub' }, 'Address 0 (where the NULL store writes)'),
      zrow('before', fr.zero_before, fr.zero_before), zrow('after', fr.zero_after, fr.zero_before),
      h('p', { class: 'note' }, fr.zero_before[0] === 0x63736d65
        ? `Before: "${ascii(fr.zero_before[0])}", Emscripten's marker. A store to address 0 overwrites it, and the assertion build reports that at exit.`
        : 'No marker at address 0 in this build: a NULL store of 0 over 0 changes nothing visible.'));
  }
  $('#run').addEventListener('click', async () => {
    const name = `sb_${wrow.replace(/-/g, '_')}_${bug}`;
    $('#run').disabled = true; $('#runstatus').replaceChildren(h('span', { class: 'status' }, 'loading…'));
    try {
      const factory = await CSys.load(`wasm/${wrow}-${bug}.js`, name);
      const r = await SBRun.runStackbugs(factory, null, `wasm/${wrow}-${bug}.wasm`);
      $('#runout').textContent = r.stdout || '(nothing)';
      $('#runerr').textContent = r.stderr || '(nothing)';
      $('#runstatus').replaceChildren(h('span', { class: 'status ' + (r.status === 0 ? 'ok' : 'bad') }, `exit status ${r.status}`));
      put($('#mem'), r.frame ? memView(r.frame) : h('p', { class: 'note' }, 'This build has no memory hooks (optimized and sanitizer builds are left untouched); pick -O0, -O0 + assertions or SAFE_HEAP to see memory.'));
    } catch (e) {
      $('#runerr').textContent = String(e);
      $('#runstatus').replaceChildren(h('span', { class: 'status bad' }, 'failed to load'));
    } finally { $('#run').disabled = false; }
  });

  // -------------------------------------------------------------------- gdb
  const G = [];
  const addG = (p, bugk, title) => { const x = cell(p, 'gdb', bugk); if (x && x.report) G.push({ title, x }); };
  addG('x86-64', 'null', 'NULL store, x86-64: run, backtrace');
  addG('arm32', 'oob', 'Off-by-one, ARM32: watchpoint on a');
  addG('x86-64', 'oob', 'Off-by-one, x86-64: watchpoint on a');
  addG('arm64', 'oob', 'Off-by-one, arm64: watchpoint on a');
  addG('arm32', 'null', 'NULL store, ARM32 (QEMU gdb stub)');
  const showG = (i) => {
    $('#gdbpick').querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === i));
    put($('#gdbcmd'), chip(G[i].x.verdict), ' ', G[i].x.summary, h('br'), h('span', { class: 'mono' }, G[i].x.cmd));
    $('#gdbout').textContent = G[i].x.report;
  };
  $('#gdbpick').append(...G.map((g, i) => h('button', { onclick: () => showG(i) }, g.title)));
  if (G.length) showG(Math.min(1, G.length - 1));

  // -------------------------------------------------------------- toolchain
  $('#toolchain').append(...PLATS.concat(P.static ? [['static', 'analyzers']] : []).map(([p, n]) =>
    h('div', {}, `${n}: `, Object.values(P[p].toolchain || {}).filter(Boolean).join(' · '))));
})();
