/* Shared browser runtime for the C sandboxes.
 * - Loads an Emscripten MODULARIZE factory and runs main() with
 *   byte-exact stdin/stdout/stderr (a fresh instance per run, like a process).
 * - Small DOM/SVG/byte helpers used by every page.
 */
(function () {
  'use strict';
  const enc = (s) => new TextEncoder().encode(s);
  const dec = (b) => new TextDecoder().decode(b);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const scripts = new Map();
  function load(url, exportName) {
    if (!scripts.has(url)) {
      scripts.set(url, new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve(window[exportName]);
        s.onerror = () => reject(new Error('failed to load ' + url));
        document.head.appendChild(s);
      }));
    }
    return scripts.get(url);
  }

  // Compile each .wasm once; instantiate a fresh instance per run.
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

  /* Run main() once. opts: {args, stdin (Uint8Array|string), files {path: bytes|string},
   * progname, wasmUrl, onModule(mod) called before main for custom setup}.
   * Returns {stdout, stderr (Uint8Array), status, module}. */
  async function run(factory, opts = {}) {
    const stdin = typeof opts.stdin === 'string' ? enc(opts.stdin) : (opts.stdin || new Uint8Array());
    const out = [], err = [];
    let pos = 0;
    const config = {
      noInitialRun: true,
      thisProgram: './' + (opts.progname || 'prog'),
      stdin: () => (pos < stdin.length ? stdin[pos++] : null),
      stdout: (c) => { if (c !== null) out.push(c & 255); },
      stderr: (c) => { if (c !== null) err.push(c & 255); },
    };
    if (opts.wasmUrl) {
      config.instantiateWasm = (imports, done) => {
        compile(opts.wasmUrl).then((m) => WebAssembly.instantiate(m, imports)).then((inst) => done(inst));
        return {};
      };
    }
    const mod = await factory(config);
    mod.FS.mkdir('/work');
    for (const [p, data] of Object.entries(opts.files || {})) {
      mod.FS.writeFile('/work/' + p, typeof data === 'string' ? enc(data) : data);
    }
    mod.FS.chdir('/work');
    if (opts.onModule) opts.onModule(mod);
    // callMain() unshifts argv[0] into the array it is given: pass a copy
    const status = mod.callMain([...(opts.args || [])]);
    return { stdout: Uint8Array.from(out), stderr: Uint8Array.from(err), status, module: mod };
  }

  /* A module instance whose main() is never run: for calling exported
   * C functions directly (steppers, memory inspection). */
  async function instance(factory, wasmUrl, extra = {}) {
    const config = { noInitialRun: true, ...extra };
    if (wasmUrl) {
      config.instantiateWasm = (imports, done) => {
        compile(wasmUrl).then((m) => WebAssembly.instantiate(m, imports)).then((inst) => done(inst));
        return {};
      };
    }
    return factory(config);
  }

  /* Fetch an SVG file and inline it so CSS can style/highlight its parts. */
  async function inlineSvg(url, into) {
    const txt = await (await fetch(url)).text();
    into.innerHTML = txt.slice(txt.indexOf('<svg'));
    const svg = into.querySelector('svg');
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.classList.add('graphviz');
    return svg;
  }
  /* Graphviz puts each node/edge in <g class="node|edge"><title>NAME</title>. */
  function gvIndex(svg) {
    const nodes = {}, edges = {};
    svg.querySelectorAll('g.node').forEach((g) => { nodes[g.querySelector('title').textContent] = g; });
    svg.querySelectorAll('g.edge').forEach((g) => { edges[g.querySelector('title').textContent.replace('&#45;&gt;', '->')] = g; });
    return { nodes, edges };
  }

  // Make control characters visible: newline -> ⏎, tab -> ⇥, NUL -> ∅.
  function visible(bytes) {
    let s = '';
    for (const b of bytes) {
      if (b === 10) s += '⏎\n';
      else if (b === 9) s += '⇥';
      else if (b === 0) s += '∅';
      else if (b === 13) s += '␍';
      else if (b < 32 || b === 127) s += '·';
      else s += String.fromCharCode(b);
    }
    return s;
  }

  function hex2(b) { return b.toString(16).padStart(2, '0'); }
  function hexdump(bytes, width = 16, base = 0) {
    const lines = [];
    for (let i = 0; i < bytes.length; i += width) {
      const row = bytes.slice(i, i + width);
      const hex = Array.from(row, hex2).join(' ').padEnd(width * 3 - 1);
      const asc = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      lines.push((base + i).toString(16).padStart(8, '0') + '  ' + hex + '  ' + asc);
    }
    return lines.join('\n');
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function debounce(fn, ms = 150) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // Remember small UI preferences per page; never required for correctness.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(location.pathname + ':' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(location.pathname + ':' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  window.CSys = { enc, dec, esc, load, run, instance, inlineSvg, gvIndex, visible, hex2, hexdump, h, s, $, $$, sleep, debounce, store };
})();
