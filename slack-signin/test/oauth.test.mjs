import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createHandler, loadConfig, USER_SCOPES } from '../server.mjs';

const config = loadConfig({ SLACK_CLIENT_ID: '123.456', SLACK_CLIENT_SECRET: 'private-secret' });

async function fixture(t, options = {}) {
  const handler = createHandler(config, options);
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    handler.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', ...options });
  const start = async () => {
    const response = await request('/auth/slack');
    const authorize = new URL(response.headers.get('location'));
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, authorize, cookie, state: authorize.searchParams.get('state') };
  };
  return { request, start };
}

function callback(state, params = 'code=one-time-code') {
  return `/oauth/callback?state=${state}&${params}`;
}

test('configuration validates credentials, HTTPS callback and TLS pairing', () => {
  assert.throws(() => loadConfig({}), /SLACK_CLIENT_ID/);
  for (const url of ['http://localhost/oauth/callback', 'https://example.com/', 'https://example.com/oauth/callback?x=1']) {
    assert.throws(() => loadConfig({ SLACK_CLIENT_ID: 'id', SLACK_CLIENT_SECRET: 'secret', SLACK_REDIRECT_URI: url }), /HTTPS/);
  }
  assert.throws(() => loadConfig({ SLACK_CLIENT_ID: 'id', SLACK_CLIENT_SECRET: 'secret', TLS_CERT_FILE: 'cert.pem' }), /both TLS/);
});

test('manifest user scopes exactly match the authorization request', () => {
  const manifest = readFileSync(new URL('../slack-app-manifest.yaml', import.meta.url), 'utf8');
  const scopes = [...manifest.matchAll(/^      - ([\w:]+)$/gm)].map((match) => match[1]);
  assert.deepEqual(USER_SCOPES, ['chat:write', 'files:write']);
  assert.deepEqual(scopes, USER_SCOPES);
  assert.match(manifest, /^  name: Qcode$/m);
  assert.ok(manifest.includes(config.redirectUri));
  assert.ok(!manifest.includes('    bot:'));
});

test('landing page and OAuth redirect keep credentials server-side', async (t) => {
  const { request, start } = await fixture(t);
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('cache-control'), 'no-store');
  const html = await home.text();
  assert.ok(!html.includes(config.clientSecret));
  assert.match(html, /Qcode/);
  assert.match(html, /chat:write/);
  assert.match(html, /files:write/);
  assert.doesNotMatch(html, /factory/i);
  const { response, authorize, state } = await start();
  assert.equal(response.status, 302);
  assert.equal(authorize.origin + authorize.pathname, 'https://slack.com/oauth/v2/authorize');
  assert.equal(authorize.searchParams.get('client_id'), config.clientId);
  assert.equal(authorize.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(authorize.searchParams.get('user_scope'), USER_SCOPES.join(','));
  assert.equal(authorize.searchParams.has('scope'), false);
  assert.equal(authorize.searchParams.has('client_secret'), false);
  assert.match(state, /^[a-f0-9]{64}$/);
  assert.match(response.headers.get('set-cookie'), /^__Host-qcode-oauth=/);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('exchanges code once and displays only the user token with safe headers', async (t) => {
  const calls = [];
  const { request, start } = await fixture(t, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ ok: true, access_token: 'xoxb-never-display', authed_user: { access_token: 'xoxp-user-token' } });
    },
  });
  const { state, cookie } = await start();
  const result = await request(callback(state), { headers: { cookie } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.match(result.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
  const html = await result.text();
  assert.match(html, /xoxp-user-token/);
  assert.match(html, /SLACK_USER_TOKEN/);
  assert.match(html, /Qcode Settings/);
  assert.doesNotMatch(html, /factory/i);
  assert.match(html, /history.replaceState/);
  assert.ok(!html.includes('xoxb-never-display'));
  assert.ok(!html.includes(config.clientSecret));
  assert.ok(!html.includes('one-time-code'));
  assert.equal(calls[0].url, 'https://slack.com/api/oauth.v2.access');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.get('client_secret'), config.clientSecret);
  assert.equal(calls[0].options.body.get('code'), 'one-time-code');
  assert.equal(calls[0].options.body.get('redirect_uri'), config.redirectUri);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal((await request(callback(state), { headers: { cookie } })).status, 400);
  assert.equal(calls.length, 1);
  assert.ok(!(await (await request('/')).text()).includes('xoxp-user-token'));
});

test('rejects missing, mismatched, cross-browser and expired state without exchanging', async (t) => {
  let now = 0;
  const { request, start } = await fixture(t, {
    now: () => now,
    fetchImpl: () => { assert.fail('Must not contact Slack'); },
  });
  const first = await start();
  const second = await start();
  for (const [path, cookie] of [
    ['/oauth/callback?code=code', first.cookie],
    [callback(first.state), ''],
    [callback('wrong'), first.cookie],
    [callback(first.state), second.cookie],
  ]) {
    assert.equal((await request(path, { headers: { cookie } })).status, 400);
  }
  now = 10 * 60 * 1000;
  assert.equal((await request(callback(first.state), { headers: { cookie: first.cookie } })).status, 400);
});

test('handles denied authorization and missing codes without contacting Slack', async (t) => {
  const { request, start } = await fixture(t, {
    fetchImpl: () => { assert.fail('Must not contact Slack'); },
  });
  for (const params of ['error=access_denied', '']) {
    const { state, cookie } = await start();
    const response = await request(callback(state, params), { headers: { cookie } });
    assert.equal(response.status, 400);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  }
});

test('sanitizes Slack failures and never falls back to a bot token', async (t) => {
  for (const fetchImpl of [
    async () => Response.json({ ok: false, error: 'sensitive-upstream-detail' }),
    async () => Response.json({ ok: true, access_token: 'xoxb-sensitive-upstream-detail' }),
    async () => Response.json({ ok: true, authed_user: { access_token: 'xoxe-sensitive-upstream-detail' } }),
    async () => new Response('sensitive-upstream-detail', { status: 429 }),
    async () => new Response('not json'),
    async () => { throw new Error('sensitive-upstream-detail'); },
  ]) {
    await t.test('exchange failure', async (t) => {
      const { request, start } = await fixture(t, { fetchImpl });
      const { state, cookie } = await start();
      const response = await request(callback(state), { headers: { cookie } });
      assert.equal(response.status, 502);
      assert.ok(!(await response.text()).includes('sensitive-upstream-detail'));
    });
  }
});

test('escapes token content rather than inserting executable markup', async (t) => {
  const { request, start } = await fixture(t, {
    fetchImpl: async () => Response.json({ ok: true, authed_user: { access_token: 'xoxp-\"><script>alert(1)</script>' } }),
  });
  const { state, cookie } = await start();
  const html = await (await request(callback(state), { headers: { cookie } })).text();
  assert.match(html, /xoxp-&quot;&gt;&lt;script&gt;/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
});
