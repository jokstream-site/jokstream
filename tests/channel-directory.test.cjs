const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const channel = { name: 'قناة اختبار', group: 'Test', url: 'https://example.invalid/live/test.m3u8?token=synthetic-only' };
const m3u = `#EXTM3U\n#EXTINF:-1 group-title="Test",${channel.name}\n${channel.url}\n`;
function setup(response) {
  const nodes = new Map();
  const logs = [];
  let requests = 0;
  const context = {
    window: { crypto: { randomUUID: () => 'synthetic' } },
    crypto: { randomUUID: () => 'synthetic' }, URL, TextDecoder, TextEncoder, Uint8Array, atob,
    document: { addEventListener() {}, getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '' });
      return nodes.get(id);
    } },
    console: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    fetch: async () => { requests++; if (response instanceof Error) throw response; return response; }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  // Keep the actual loader/decoder/normalizer; isolate unrelated DOM rendering.
  vm.runInContext('populateCategories = () => {}; applyChannelFilters = () => {};', context);
  return { context, nodes, logs, requests: () => requests };
}
for (const [label, body, encoding, format] of [
  ['direct M3U with BOM and CRLF', '\uFEFF \n' + m3u.replace(/\n/g, '\r\n'), 'direct', 'm3u'],
  ['legacy Base64 M3U', Buffer.from(m3u).toString('base64'), 'base64', 'm3u'],
  ['direct JSON', JSON.stringify([channel]), 'direct', 'json'],
  ['legacy Base64 JSON', Buffer.from(JSON.stringify([channel])).toString('base64'), 'base64', 'json'],
  ['headerless M3U', m3u.slice(m3u.indexOf('#EXTINF:')), 'direct', 'm3u']
]) {
  test(label, async () => {
    const s = setup(new Response(body, { headers: { 'Content-Type': 'application/octet-stream' } }));
    await s.context.loadChannels();
    assert.equal(s.nodes.get('channelCount').textContent, '1');
    const d = s.logs[0][1];
    assert.equal(d.status, 200);
    // Response.text() removes a leading UTF-8 BOM before the loader measures text.
    assert.equal(d.responseBytes, Buffer.byteLength(body.replace(/^\uFEFF/, '')));
    assert.equal(d.encoding, encoding);
    assert.equal(d.format, format);
    assert.equal(d.extinfCount, format === 'm3u' ? 1 : 0);
    assert.equal(d.acceptedChannels, 1);
    assert.equal(d.stage, 'complete');
    assert.equal(vm.runInContext('allChannels[0].name', s.context), channel.name);
    assert.equal(s.requests(), 1);
    assert.ok(!JSON.stringify(s.logs).includes(channel.name));
    assert.ok(!JSON.stringify(s.logs).includes(channel.url));
    assert.ok(!JSON.stringify(s.logs).includes('synthetic-only'));
  });
}
test('JSON skips invalid entries and removes duplicates without discarding good channels', async () => {
  const s = setup(new Response(JSON.stringify([channel, channel, null, { name: 'invalid', url: 'relative.m3u8' }])));
  await s.context.loadChannels();
  const d = s.logs[0][1];
  assert.equal(d.parsedEntries, 4);
  assert.equal(d.rejectedEntries, 2);
  assert.equal(d.duplicateEntries, 1);
  assert.equal(d.acceptedChannels, 1);
});
test('M3U deduplicates and rejects relative/unsupported URLs', () => {
  const s = setup();
  const result = s.context.decodeChannelDirectory(m3u + m3u + '#EXTINF:-1,Relative\nchild.m3u8\n#EXTINF:-1,Other\nftp://example.invalid/live\n');
  assert.equal(result.extinfCount, 4);
  assert.equal(result.directory.length, 1);
});
for (const body of ['#EXTM3U\n', '[]', Buffer.from('[]').toString('base64')]) {
  test('valid empty directory remains distinguishable from failure: ' + body.trim(), async () => {
    const s = setup(new Response(body));
    await s.context.loadChannels();
    assert.equal(s.nodes.get('channelCount').textContent, '0');
    assert.equal(s.nodes.get('playerStatus').textContent, 'Channel directory is empty');
    assert.equal(s.logs[0][1].stage, 'complete');
  });
}
for (const body of ['<html>synthetic-private-marker</html>', '{"error":"synthetic-private-marker"}', '[broken-json', '', Buffer.from('synthetic-private-marker').toString('base64'), '//4=']) {
  test('invalid body produces safe failure', async () => {
    const s = setup(new Response(body));
    await s.context.loadChannels();
    assert.equal(s.nodes.get('resultsCount').textContent, 'Unavailable');
    assert.equal(s.nodes.get('channelCount').textContent, '0');
    assert.equal(s.logs[0][1].stage, 'decode-and-parse');
    assert.ok(!JSON.stringify(s.logs).includes('synthetic-private-marker'));
  });
}
test('HTTP error is reported without reading or logging its body', async () => {
  let read = false;
  const s = setup({ ok: false, status: 503, text: async () => { read = true; return channel.url; } });
  await s.context.loadChannels();
  assert.equal(read, false);
  assert.equal(s.logs[0][1].status, 503);
  assert.equal(s.logs[0][1].stage, 'http');
  assert.equal(s.nodes.get('resultsCount').textContent, 'Unavailable');
});
test('network errors never log their raw private message', async () => {
  const s = setup(new Error(channel.url));
  await s.context.loadChannels();
  assert.equal(s.logs[0][1].status, null);
  assert.equal(s.logs[0][1].stage, 'request');
  assert.ok(!JSON.stringify(s.logs).includes(channel.url));
});
test('initial proxy route preserves the source as one encoded parameter', () => {
  const s = setup();
  const proxied = new URL(s.context.resolveStreamUrl(channel));
  assert.equal(proxied.origin, 'https://jokstreamproxy1.abdonarjah.workers.dev');
  assert.equal(proxied.searchParams.get('proxy_url'), channel.url);
  assert.equal([...proxied.searchParams].length, 1);
});
