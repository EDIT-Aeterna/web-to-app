import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Execute the actual injected script, rather than checking source substrings.
const source = readFileSync(new URL('../app/src/main/java/com/webtoapp/core/webview/WebViewManager.kt', import.meta.url), 'utf8');
const script = source.split('internal object PrivateNetworkApiBridgeScriptHolder {')[1].split('"""')[1];
const payload = new Uint8Array([137, 80, 78, 71]);

function environment() {
  class NativeXHR {
    constructor() { this.listeners = {}; this.responseType = ''; this.timeout = 0; this.withCredentials = false; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    open(method, url, async) { this.async = async; this.readyState = 1; this.responseURL = url; }
    get responseText() {
      if (!['', 'text'].includes(this.responseType)) throw new Error('InvalidStateError: binary responseText');
      return 'text';
    }
    send() {
      this.response = this.responseType === 'blob' ? new Blob([payload])
        : this.responseType === 'arraybuffer' ? payload.slice().buffer
        : this.responseType === 'json' ? { ok: true } : 'text';
      this.readyState = 4; this.status = 200; this.statusText = 'OK';
      for (const type of ['readystatechange', 'load', 'loadend']) this.listeners[type]({ type });
    }
  }
  const window = {
    location: { href: 'http://192.168.7.21:4198/', hostname: '192.168.7.21', port: '4198' },
    XMLHttpRequest: NativeXHR,
    NativeBridge: { httpRequest: () => JSON.stringify({ ok: true, status: 200, headers: { 'content-type': 'image/png' }, bodyBase64: Buffer.from(payload).toString('base64') }) },
  };
  const context = vm.createContext({ window, URL, Blob, Uint8Array, TextDecoder, TextEncoder, Promise, atob, btoa, setTimeout });
  vm.runInContext(script, context);
  return window;
}

for (const responseType of ['', 'text', 'blob', 'arraybuffer', 'json']) {
  test(`same-origin XHR preserves ${responseType || 'default text'} response and events`, async () => {
    const window = environment();
    const xhr = new window.XMLHttpRequest();
    xhr.open('GET', window.location.href); // Omitted async must remain asynchronous.
    xhr.responseType = responseType;
    xhr.timeout = 1000;
    xhr.withCredentials = true;
    const events = [];
    for (const type of ['readystatechange', 'load', 'loadend']) xhr.addEventListener(type, () => events.push(type));
    xhr.send();
    assert.equal(xhr._xhr.async, true);
    assert.equal(xhr._xhr.responseType, responseType);
    assert.equal(xhr._xhr.timeout, 1000);
    assert.equal(xhr._xhr.withCredentials, true);
    assert.deepEqual(events, ['readystatechange', 'load', 'loadend']);
    if (responseType === 'blob') assert.deepEqual(new Uint8Array(await xhr.response.arrayBuffer()), payload);
    else if (responseType === 'arraybuffer') assert.deepEqual(new Uint8Array(xhr.response), payload);
    else if (responseType === 'json') assert.deepEqual(xhr.response, { ok: true });
    else assert.equal(xhr.responseText, 'text');
  });
}

test('cross-origin bridge still returns a Blob with the original bytes', async () => {
  const window = environment();
  const xhr = new window.XMLHttpRequest();
  xhr.open('GET', 'http://192.168.7.22/image.png', true);
  xhr.responseType = 'blob';
  await new Promise((resolve, reject) => { xhr.onload = resolve; xhr.onerror = reject; xhr.send(); });
  assert.equal(xhr._native, false);
  assert.equal(xhr.response.type, 'image/png');
  assert.deepEqual(new Uint8Array(await xhr.response.arrayBuffer()), payload);
});
