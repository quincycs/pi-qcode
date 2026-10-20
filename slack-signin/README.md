# Qcode Slack sign-in

A standalone, dependency-free Node.js 22+ webapp that gets a Slack **user token** (`xoxp-`) through OAuth. Users click **Continue with Slack**, approve access, and copy their token from the result page. Only the app operator needs the Slack app settings and client secret.

This helper supplies `SLACK_USER_TOKEN` for Qcode’s optional **Slack Share** feature. It runs separately from the VS Code extension and does not obtain the separate bot token.

## 1. Create the Slack app (operator, once)

1. Open <https://api.slack.com/apps>, choose **Create New App → From a manifest**, and select your workspace.
2. Paste [`slack-app-manifest.yaml`](./slack-app-manifest.yaml) to create **Qcode**.
3. Copy the **Client ID** and **Client Secret** from **Basic Information → App Credentials** into the server’s `.env` (below).

The manifest and authorization request include only these **user scopes**:

| Scope         | Purpose                                      |
| ------------- | -------------------------------------------- |
| `chat:write`  | Post user messages and thread replies as you |
| `files:write` | Upload attachments to shared threads         |

No search, channel listing, user lookup, or message history read scopes are needed. Qcode uses the channel ID you configure directly. The permissions themselves are not restricted to that channel. Your user must have access to the target channel.

Slack enforces workspace policies; OAuth does not bypass administrator approval. Keep token rotation disabled for this copy-a-token workflow (there is no refresh-token manager). If adapting an existing app, remove its old scopes and reauthorize; changing this manifest alone does not revoke existing grants.

## 2. Run locally

From the repository root:

```sh
cd slack-signin
cp .env.example .env
# Edit .env: set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.

# macOS example; mkcert also supports other platforms.
brew install mkcert
mkcert -install
mkdir -p certs
mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1

npm start
```

Open **https://localhost:3443**. No `npm install` is needed. `mkcert -install` adds a local certificate authority to your trust store; never share its private key. `.env` and `certs/` are gitignored.

For hosting behind an HTTPS reverse proxy, set `SLACK_REDIRECT_URI` to the registered HTTPS callback URL and unset both TLS file variables. Keep the HTTP backend private and disable request URL logging on the proxy so OAuth codes are not recorded.

## 3. Configure Qcode Slack Share

You can use the same **Qcode** Slack app for both tokens; a separate bot app is not required.

1. Use the sign-in helper above to obtain your user token, beginning with `xoxp-`. Paste it into `SLACK_USER_TOKEN` in Qcode **Settings → Slack Share**.
2. Open <https://api.slack.com/apps> and select **Qcode**.
3. Under **OAuth & Permissions → Scopes → Bot Token Scopes**, add `chat:write` for assistant replies. The supplied manifest only configures user scopes, so add this bot scope manually.
4. Click **Install to Workspace** (or **Reinstall to Workspace**) and approve access.
5. Go to **OAuth & Permissions → Bot User OAuth Token** and copy the token beginning with `xoxb-`. Paste it into Qcode’s `SLACK_BOT_TOKEN`.
6. In your target Slack channel, invite the bot with `/invite @Qcode`. Your user must also have access to the channel.
7. In Qcode **Settings → Slack Share**, set `SLACK_CHANNEL_ID` to that channel’s ID and enable Slack Share.

The helper does not save tokens. Qcode stores credentials in plain text in `~/.pi/qcode/settings.json`, although they are masked in its UI. Treat tokens like passwords: do not commit or share them. Clear the result page and close the tab when done; your clipboard may retain the copied token.

## Tests

```sh
cd slack-signin
npm test
```

Tests use a mocked Slack exchange and cover reduced scopes/manifest consistency, Qcode branding, callback validation, state expiration/replay, denial, errors, and safe token rendering. A real workspace OAuth approval still needs a manual smoke test with your app credentials.
