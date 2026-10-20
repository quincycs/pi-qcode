import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const USER_SCOPES = ['chat:write', 'files:write'];
const COOKIE = '__Host-qcode-oauth';
const STATE_TTL = 10 * 60 * 1000;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function loadConfig(env = process.env) {
  const clientId = env.SLACK_CLIENT_ID?.trim();
  const clientSecret = env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || clientId.startsWith('replace-') || clientSecret.startsWith('replace-')) {
    throw new Error('Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env.');
  }
  const redirectUri = env.SLACK_REDIRECT_URI || 'https://localhost:3443/oauth/callback';
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'https:' || redirect.pathname !== '/oauth/callback'
      || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new Error('SLACK_REDIRECT_URI must be an HTTPS URL ending in /oauth/callback, without a query or fragment.');
  }
  const port = Number(env.PORT || 3443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  if (Boolean(env.TLS_CERT_FILE) !== Boolean(env.TLS_KEY_FILE)) {
    throw new Error('Set both TLS_CERT_FILE and TLS_KEY_FILE, or neither behind an HTTPS reverse proxy.');
  }
  return {
    clientId, clientSecret, redirectUri, port,
    host: env.HOST || '127.0.0.1',
    certFile: env.TLS_CERT_FILE, keyFile: env.TLS_KEY_FILE,
  };
}

function page(res, status, title, content, script = '') {
  const nonce = randomBytes(18).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Qcode</title>
<style nonce="${nonce}">
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 6vh 1.5rem; background: #171923; color: #eef0f7; }
main { max-width: 620px; margin: auto; padding: 2rem; background: #252938; border-radius: 16px; }
h1 { margin-top: 0; } p, li { line-height: 1.6; } small { color: #bac1d4; }
a { color: #bdc9ff; } .button, button { display: inline-block; border: 0; border-radius: 8px; padding: .8rem 1rem; background: #bac8ff; color: #171923; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; margin: .5rem .5rem .5rem 0; }
input { box-sizing: border-box; width: 100%; padding: 1rem; margin: .75rem 0; font: 14px monospace; }
#notice { min-height: 1.6em; } code { overflow-wrap: anywhere; }
</style></head><body><main><small>QCODE</small><h1>${escapeHtml(title)}</h1>${content}</main>
<script nonce="${nonce}">if (location.pathname === '/oauth/callback') history.replaceState(null, '', '/');
${script}</script></body></html>`);
}

function failure(res, status, message) {
  page(res, status, 'Sign-in could not finish', `<p>${escapeHtml(message)}</p><a class="button" href="/">Start again</a>`);
}

function tokenPage(res, token) {
  page(res, 200, 'Your Slack user token', `
<p>Copy this token into <code>SLACK_USER_TOKEN</code> in Qcode Settings → Slack Share. It allows Qcode to post messages and upload attachments as you. No channel or message history read scopes are requested.</p>
<label for="token">User access token</label>
<input id="token" type="password" value="${escapeHtml(token)}" readonly autocomplete="off" spellcheck="false">
<button id="copy" type="button">Copy token</button><button id="reveal" type="button">Show token</button><button id="clear" type="button">Clear token</button>
<p id="notice" role="status"></p>
<p><small>This app does not save your token. Treat it like a password: do not paste it into Slack, commit it, or share it. Clear it and close this tab when done. Your clipboard may retain the copied token.</small></p>`, `
const token = document.getElementById('token');
const notice = document.getElementById('notice');
document.getElementById('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(token.value); notice.textContent = 'Copied.'; }
  catch { notice.textContent = 'Clipboard unavailable. Show the token and copy it manually.'; }
};
document.getElementById('reveal').onclick = (event) => {
  token.type = token.type === 'password' ? 'text' : 'password';
  event.target.textContent = token.type === 'password' ? 'Show token' : 'Hide token';
};
const clear = () => { token.value = ''; token.removeAttribute('value'); };
document.getElementById('clear').onclick = () => { clear(); location.replace('/'); };
window.addEventListener('pagehide', clear);
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
`);
}

export function createHandler(config, { fetchImpl = fetch, now = Date.now } = {}) {
  // Only short-lived CSRF state is kept in memory; never codes or access tokens.
  const pending = new Map();
  const prune = () => {
    for (const [state, expiresAt] of pending) if (expiresAt <= now()) pending.delete(state);
  };
  const expiryTimer = setInterval(prune, 60_000);
  expiryTimer.unref();

  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(req.url, config.redirectUri);
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return failure(res, 405, 'Only GET requests are supported.');
      }
      if (url.pathname === '/') {
        return page(res, 200, 'Connect your Slack account', `
<p>Get a personal Slack user token for Qcode without looking through Slack’s app settings.</p>
<ul><li>Post your messages and thread replies as you.</li><li>Upload attachments to your shared Qcode threads.</li></ul>
<p>Requests only <code>chat:write</code> and <code>files:write</code>. No search, channel listing, or message history read scopes are requested. These permissions are not limited to one channel; choose your sharing channel in Qcode. Slack workspace approval policies still apply.</p>
<a class="button" href="/auth/slack">Continue with Slack</a>
<p><small>You’ll approve access on Slack, then return here to copy your token. The client secret stays on the server; tokens are never saved by this app.</small></p>`);
      }
      if (url.pathname === '/auth/slack') {
        prune();
        if (pending.size >= 1000) return failure(res, 503, 'Too many sign-in attempts. Please try again later.');
        const state = randomBytes(32).toString('hex');
        pending.set(state, now() + STATE_TTL);
        res.setHeader('Set-Cookie', `${COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
        const authorize = new URL('https://slack.com/oauth/v2/authorize');
        authorize.search = new URLSearchParams({
          client_id: config.clientId, user_scope: USER_SCOPES.join(','),
          redirect_uri: config.redirectUri, state,
        }).toString();
        res.writeHead(302, { Location: authorize.toString() });
        return res.end();
      }
      if (url.pathname !== '/oauth/callback') return failure(res, 404, 'Page not found.');

      const state = url.searchParams.get('state');
      const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      prune();
      if (!state || state !== cookie || !pending.has(state)) {
        return failure(res, 400, 'Sign-in expired or could not be verified. Start again in the same browser.');
      }
      // Consume state before any asynchronous work to prevent callback replay.
      pending.delete(state);
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      if (url.searchParams.has('error')) return failure(res, 400, 'Slack authorization was declined or failed.');
      const code = url.searchParams.get('code');
      if (!code) return failure(res, 400, 'Slack did not return an authorization code.');

      let result;
      try {
        const response = await fetchImpl('https://slack.com/api/oauth.v2.access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.clientId, client_secret: config.clientSecret,
            code, redirect_uri: config.redirectUri,
          }),
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        });
        if (!response.ok) throw new Error('Slack HTTP failure');
        result = await response.json();
      } catch {
        return failure(res, 502, 'Could not exchange the code with Slack. Please start again.');
      }
      // Never use the top-level (bot) access_token or render raw Slack errors.
      const token = result?.authed_user?.access_token;
      if (result?.ok !== true || typeof token !== 'string' || !token.startsWith('xoxp-')) {
        return failure(res, 502, 'Slack did not return a user token. Check the app’s user scopes and keep token rotation disabled, then start again.');
      }
      return tokenPage(res, token);
    } catch {
      // Do not log request URLs, OAuth codes, secrets, tokens, or Slack payloads.
      return failure(res, 500, 'An unexpected error occurred. Please start again.');
    }
  };
  handler.close = () => clearInterval(expiryTimer);
  return handler;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig();
    const handler = createHandler(config);
    const server = config.certFile
      ? createHttpsServer({ cert: readFileSync(config.certFile), key: readFileSync(config.keyFile) }, handler)
      : createHttpServer(handler);
    server.on('close', handler.close);
    server.on('error', () => {
      console.error('Unable to start listener. Check HOST, PORT, and TLS settings.');
      process.exit(1);
    });
    server.listen(config.port, config.host, () => {
      console.log(`Qcode sign-in: ${new URL(config.redirectUri).origin}`);
      if (!config.certFile) console.log('HTTP backend: expose only through an HTTPS reverse proxy.');
    });
  } catch {
    console.error('Unable to start. Check .env credentials, HTTPS redirect URL, port, and TLS certificate paths.');
    process.exit(1);
  }
}
