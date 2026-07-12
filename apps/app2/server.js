const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { Issuer, generators } = require('openid-client');

const app = express();
const PORT = 3002;
const NOMBRE = "App Finanzas";
const COLOR = "#2E7D32";
const KC_URL = 'http://localhost:8080';
const REALM = 'acmecorp';
const SELF_SERVICE_URL = 'http://localhost:3004';

app.use(session({ secret: 'secret-app2', resave: false, saveUninitialized: false }));

let client;
let issuerUrl;

async function init() {
  const issuer = await Issuer.discover(KC_URL + '/realms/' + REALM);
  issuerUrl = KC_URL + '/realms/' + REALM;
  client = new issuer.Client({
    client_id: 'acmecorp-portal',
    client_secret: 'portal-secret-local',
    redirect_uris: [`http://localhost:${PORT}/callback`],
    post_logout_redirect_uris: [`http://localhost:${PORT}`],
    response_types: ['code']
  });
  app.listen(PORT, () => console.log(`${NOMBRE} → http://localhost:${PORT}`));
}

// ─── Helpers ──────────────────────────────────────────

async function userHasMfa(accessToken) {
  try {
    const res = await axios.get(
      KC_URL + '/realms/' + REALM + '/account/credentials',
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    const mfaTypes = ['otp', 'webauthn', 'webauthn-passwordless', 'recovery-authn-codes'];
    for (const c of res.data) {
      const type = c.type || '';
      if (mfaTypes.includes(type)) {
        if (c.userCredentialMetadatas && c.userCredentialMetadatas.length > 0) {
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    console.error('userHasMfa error:', e.message);
    return true;
  }
}

function decodeJwt(token) {
  const payload = token.split('.')[1];
  const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString());
}

// ─── Middleware ───────────────────────────────────────

const auth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const mfaGate = async (req, res, next) => {
  if (!req.session.user || !req.session.accessToken) return next();
  if (req.session.mfaChecked) return next();
  const hasMfa = await userHasMfa(req.session.accessToken);
  req.session.mfaChecked = true;
  if (!hasMfa) {
    const returnTo = `http://localhost:${PORT}`;
    return res.redirect(`${SELF_SERVICE_URL}/gatekeeper?returnTo=${encodeURIComponent(returnTo)}`);
  }
  next();
};

// ─── Routes ───────────────────────────────────────────

app.get('/login', (req, res) => {
  const state = generators.state();
  req.session.state = state;
  const url = client.authorizationUrl({
    scope: 'openid profile email',
    state
  });
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  try {
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(
      `http://localhost:${PORT}/callback`,
      params,
      { state: req.session.state }
    );

    const accessClaims = decodeJwt(tokenSet.access_token);
    const idClaims = tokenSet.claims();

    req.session.accessToken = tokenSet.access_token;
    req.session.idToken = tokenSet.id_token;
    req.session.refreshToken = tokenSet.refresh_token;
    req.session.mfaChecked = false;
    req.session.user = {
      name: idClaims.name || idClaims.preferred_username,
      email: idClaims.email,
      preferred_username: idClaims.preferred_username,
      sid: idClaims.sid,
      roles: (accessClaims.realm_access && accessClaims.realm_access.roles) || []
    };

    res.redirect('/');
  } catch (e) {
    console.error('Callback error:', e.message);
    res.status(500).send(`<pre>Authentication error:\n${e.message}</pre>`);
  }
});

app.get('/logout', (req, res) => {
  const idToken = req.session.idToken;
  req.session.destroy(() => {
    if (idToken) {
      const logoutUrl = `${issuerUrl}/protocol/openid-connect/logout` +
        `?id_token_hint=${idToken}` +
        `&post_logout_redirect_uri=http://localhost:${PORT}`;
      return res.redirect(logoutUrl);
    }
    res.redirect('/');
  });
});

app.get('/', auth, mfaGate, (req, res) => {
  const u = req.session.user;
  res.send(`
    <html><head><title>${NOMBRE}</title></head>
    <body style="font-family:Arial,sans-serif;margin:0;background:#f0f4f8">
      <div style="background:${COLOR};color:white;padding:20px 30px">
        <h2 style="margin:0">🏢 ${NOMBRE}</h2>
        <span style="font-size:13px;opacity:.9">Single Sign-On demo · MFA enforced at login</span>
      </div>
      <div style="padding:30px;max-width:750px">

        <div style="background:white;padding:25px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);margin-bottom:20px">
          <h3 style="margin-top:0">👋 Bienvenido, ${u.name}</h3>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#666;width:130px">Email</td><td>${u.email}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Roles</td><td><code>${u.roles.join(', ') || '(none)'}</code></td></tr>
            <tr><td style="padding:6px 0;color:#666">Session ID</td><td><code style="font-size:11px">${u.sid}</code></td></tr>
          </table>
        </div>

        <div style="background:white;padding:25px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);margin-bottom:20px">
          <h3 style="margin-top:0">🧪 Prueba el SSO</h3>
          <p>→ <a href="http://localhost:3001" target="_blank">Abrir Portal Empleados (3001)</a></p>
          <p>→ <a href="http://localhost:3003" target="_blank">Abrir Admin Panel (3003)</a> — <em>solo si tienes rol admin</em></p>
          <p>→ <a href="http://localhost:3004" target="_blank">Abrir Self-Service Portal (3004)</a></p>
        </div>

        <div style="margin-top:20px">
          <a href="/logout" style="color:#c62828;text-decoration:none">🚪 Logout global (SLO)</a>
        </div>

        <details style="margin-top:20px;background:white;padding:15px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
          <summary style="cursor:pointer;font-weight:bold;color:#555">📦 Ver claims del access_token</summary>
          <pre style="margin-top:10px;font-size:11px;overflow:auto;background:#f5f5f5;padding:10px;border-radius:4px">${JSON.stringify(decodeJwt(req.session.accessToken), null, 2)}</pre>
        </details>

      </div>
    </body></html>
  `);
});

init().catch(e => {
  console.error('Failed to init:', e.message);
  process.exit(1);
});
