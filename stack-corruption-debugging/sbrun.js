/* Runs one Emscripten build of stackbugs and records what happened:
 * stdout, stderr (including Emscripten aborts and traps), exit status, and
 * snapshots of linear memory taken by FRAME_HOOK before and after sub().
 *
 * Shared by the page (browser) and tools/wasm_run.mjs (CI, Node), so the
 * sandbox shows exactly what the CI matrix measured. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SBRun = factory();
}(this, function () {
  'use strict';

  // Browser: fetch and compile each .wasm once (no streaming-compile
  // fallbacks or warnings), instantiate a fresh copy per run.
  const compiled = new Map();
  function compile(url) {
    if (!compiled.has(url)) {
      compiled.set(url, fetch(url).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
        return r.arrayBuffer();
      }).then((buf) => WebAssembly.compile(buf)));
    }
    return compiled.get(url);
  }

  async function runStackbugs(createModule, extraConfig, wasmUrl) {
    const out = [], err = [];
    const snaps = [];
    let mod = null;
    const words = (lo, hi) => {
      const r = [];
      for (let p = lo; p < hi; p += 4) r.push(mod.HEAP32[p >> 2] >>> 0);
      return r;
    };
    const config = Object.assign({
      noInitialRun: true,
      thisProgram: './stackbugs',
      print: (s) => out.push(s + '\n'),
      printErr: (s) => err.push(s + '\n'),
      // called from main() through FRAME_HOOK (SANDBOX builds only)
      onFrame: (when, a, b) => {
        const lo = (Math.min(a, b) - 8) & ~3, hi = (Math.max(a + 4, b + 20) + 8 + 3) & ~3;
        snaps.push({ when, a, b, lo, hi, words: words(lo, hi), zero: words(0, 16) });
      },
    }, extraConfig || {});
    if (wasmUrl) {
      config.instantiateWasm = (imports, done) => {
        compile(wasmUrl).then((m) => WebAssembly.instantiate(m, imports)).then((inst) => done(inst));
        return {};
      };
    }
    mod = await createModule(config);
    let status;
    try {
      status = mod.callMain([]);
    } catch (e) {
      // abort() and wasm traps end the run with an exception
      status = (e && e.name === 'ExitStatus') ? e.status : 1;
      const msg = String((e && e.message) || e);
      const shown = err.join('');
      if (!shown.includes(msg.split('.')[0])) err.push(`${(e && e.name) || 'Error'}: ${msg}\n`);
    }
    const frame = snaps.length ? {
      a: snaps[0].a, b: snaps[0].b, lo: snaps[0].lo, hi: snaps[0].hi,
      before: snaps[0].words, after: (snaps[1] || snaps[0]).words,
      zero_before: snaps[0].zero, zero_after: (snaps[1] || snaps[0]).zero,
      complete: snaps.length > 1,
    } : null;
    return { status, stdout: out.join(''), stderr: err.join(''), frame };
  }

  return { runStackbugs };
}));
