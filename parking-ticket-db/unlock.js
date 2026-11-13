/* Unlock a private demo: decrypt bundle.bin with the passphrase (PBKDF2 ->
 * AES-256-GCM, all in this browser), store the files in Cache Storage and
 * let sw.js serve them under app/. Nothing is sent to any server. A link may
 * carry the passphrase in its #k= fragment, which browsers never transmit. */
(function () {
  'use strict';
  const root = document.documentElement;
  const SLUG = root.dataset.slug, VERSION = root.dataset.version;
  const CACHE = `locked:${SLUG}:${VERSION}`;
  const $ = (s) => document.querySelector(s);
  const enc = new TextEncoder();
  const say = (msg, bad) => { const el = $('#status'); el.textContent = msg; el.className = 'note' + (bad ? ' bad' : ''); };
  const supported = 'serviceWorker' in navigator && 'caches' in window && window.isSecureContext &&
    window.crypto && crypto.subtle && 'DecompressionStream' in window;

  async function decrypt(buf, pass) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (String.fromCharCode(...buf.subarray(0, 4)) !== 'LKD1') throw new Error('unexpected bundle format');
    const salt = buf.slice(4, 20), iv = buf.slice(20, 32), iterations = view.getUint32(32, true), ct = buf.slice(36);
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let z;
    try {
      z = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(SLUG) }, key, ct);
    } catch (e) {
      throw new Error('wrong passphrase');
    }
    const plain = new Uint8Array(await new Response(new Blob([z]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    if (String.fromCharCode(...plain.subarray(0, 4)) !== 'CSB1') throw new Error('unexpected payload');
    const mlen = new DataView(plain.buffer).getUint32(4, true);
    const manifest = JSON.parse(new TextDecoder().decode(plain.subarray(8, 8 + mlen)));
    let off = 8 + mlen;
    return manifest.map((m) => { const f = { ...m, data: plain.slice(off, off + m.size) }; off += m.size; return f; });
  }

  async function installWorker() {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './app/' });
    const sw = reg.installing || reg.waiting || reg.active;
    if (sw && sw.state !== 'activated') {
      await new Promise((resolve) => sw.addEventListener('statechange', () => { if (sw.state === 'activated') resolve(); }));
    }
  }

  async function unlock(pass) {
    if (!supported) { say('This browser cannot open private demos (a private/incognito window may block the storage it needs).', true); return; }
    $('#go').disabled = true;
    say('Decrypting in your browser…');
    try {
      const res = await fetch('bundle.bin', { cache: 'no-cache' });
      if (!res.ok) throw new Error('bundle not found');
      const files = await decrypt(new Uint8Array(await res.arrayBuffer()), pass);
      for (const name of await caches.keys()) if (name.startsWith(`locked:${SLUG}:`) && name !== CACHE) await caches.delete(name);
      const cache = await caches.open(CACHE);
      const base = new URL('app/', location.href);
      await Promise.all(files.map((f) => cache.put(new URL(f.path, base).href,
        new Response(f.data, { headers: { 'Content-Type': f.type } }))));
      await installWorker();
      say('Unlocked. Opening…');
      location.replace('app/');
    } catch (e) {
      say(e.message === 'wrong passphrase' ? 'That passphrase does not open this demo.' : 'Could not open the demo: ' + e.message, true);
      $('#go').disabled = false;
    }
  }

  // a link like .../SLUG/#k=PASSPHRASE unlocks directly; the fragment is
  // removed from the address bar right away
  function fromHash() {
    const m = location.hash.match(/^#k=(.+)$/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    unlock(decodeURIComponent(m[1]));
    return true;
  }

  async function init() {
    $('#form').addEventListener('submit', (e) => { e.preventDefault(); unlock($('#pass').value.trim()); });
    window.addEventListener('hashchange', fromHash);
    if (fromHash()) return;
    if (supported && (await caches.has(CACHE)) && (await navigator.serviceWorker.getRegistration('./app/'))) {
      $('#open').hidden = false;
      say('Already unlocked in this browser.');
    }
  }
  init();
})();
