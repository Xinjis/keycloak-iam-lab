const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { Issuer, generators } = require('openid-client');

const app = express();
const PORT = 3001;
const NOMBRE = "Portal Empleados";
const COLOR = "#1565C0";
const KC_URL = 'http://localhost:8080';
const REALM = 'acmecorp';
const SELF_SERVICE_URL = 'http://localhost:3004';

app.use(session({ secret: 'secret-app1', resave: false, saveUninitialized: false }));

let client;

async function init() {
  const issuer = await Issuer.discover(KC_URL + '/realms/' + REALM);
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
    return true; // fail-open en errores para no bloquear al usuario
  }
}

// ─── Middleware ───────────────────────────────────────

const auth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

// Gatekeeper: si el usuario está autenticado pero no tiene MFA → redirigir al selector
const mfaGate = async (req, res, next) => {
  if (!req.session.user || !req.session.accessToken) return next();
  // Solo comprobar una vez por sesión para no penalizar rendimiento
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

app.get('/', auth, mfaGate, (req, res) => {
  const u = req.session.user;
  res.send(`
    <html><head><title>${NOMBRE}</title></head>
    <body style="font-family:Arial;margin:0;background:#f0f4f8">
      <div style="background:${COLOR};color:white;padding:20px 30px">
        <h2>🏢 ${NOMBRE}</h2>
      </div>
      <div style="padding:30px;max-width:650px">
        <div style="background:white;padding:25px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1)">
          <h3>👋 Bienvenido, ${u.name}</h3>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#666">Email</td><td>${u.email}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Roles</td><td><code>${u.roles.join(', ')}</code></td></tr>
            <tr><td style="padding:6px 0;color:#666">Session ID</td><td><code style="font-size:11px">${u.sid}</code></td></tr>
          </table>
          <hr style="margin:20px 0">
          <p>🧪 <strong>Prueba el SSO:</strong></p>
          <p>→ <a href="http://localhost:3002" target="_blank">Abrir App Finanzas (3002)</a>
             — <em>no te pedirá login</em></p>
          <p>→ <a href="http://localhost:3004" target="_blank">Gestionar métodos 2FA</a></p>
          <hr style="margin:20px 0">
          <a href="/logout" style="color:#c62828;text-decoration:none">🚪 Logout global</a>
        </div>
        <details style="margin-top:20px">
          <summary style="cursor:pointer;color:#666">Ver claims completos del access_token</summary>
          <pre style="background:#f5f5f5;padding:15px;border-radius:4px;font-size:11px;overflow:auto">${JSON.stringify(u.claims, null, 2)}</pre>
        </details>
      </div>
    </body></html>
  `);
});

app.get('/login', (req, res) => {
  const cv = generators.codeVerifier();
  const state = generators.state();
  const nonce = generators.nonce();
  req.session.cv = cv;
  req.session.state = state;
  req.session.nonce = nonce;
  res.redirect(client.authorizationUrl({
    scope: 'openid email profile',
    code_challenge: generators.codeChallenge(cv),
    code_challenge_method: 'S256',
    state, nonce
  }));
});

app.get('/callback', async (req, res) => {
  try {
    const ts = await client.callback(`http://localhost:${PORT}/callback`,
      client.callbackParams(req),
      { code_verifier: req.session.cv, state: req.session.state, nonce: req.session.nonce });
    const claims = ts.claims();
    req.session.user = {
      name: claims.name || claims.preferred_username,
      email: claims.email,
      roles: claims.realm_access?.roles || [],
      sid: claims.sid,
      claims
    };
    req.session.idToken = ts.id_token;
    req.session.accessToken = ts.access_token;
    req.session.mfaChecked = false; // recheck en el próximo request
    res.redirect('/');
  } catch(e) {
    res.status(500).send(`Error: ${e.message}`);
  }
});

app.get('/logout', (req, res) => {
  const idToken = req.session.idToken;
  req.session.destroy();
  res.redirect(client.endSessionUrl({
    id_token_hint: idToken,
    post_logout_redirect_uri: `http://localhost:${PORT}`
  }));
});

init();
