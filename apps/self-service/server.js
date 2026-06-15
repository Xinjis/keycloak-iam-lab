const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const { Issuer, generators } = require('openid-client');

const app = express();
const PORT = 3004;
const KC_URL = process.env.KC_URL || 'http://localhost:8080';
const REALM = 'acmecorp';
const CLIENT_ID = 'acmecorp-self-service';
const CLIENT_SECRET = 'selfservice-secret-local';

app.use(express.json());
app.use(session({
  secret: 'self-service-session-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 30 * 60 * 1000 }
}));

let oidcClient = null;

async function initOidc() {
  const issuer = await Issuer.discover(KC_URL + '/realms/' + REALM);
  oidcClient = new issuer.Client({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uris: ['http://localhost:' + PORT + '/callback'],
    response_types: ['code']
  });
  console.log('OIDC client initialized');
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'not authenticated' });
    }
    return res.redirect('/login');
  }
  next();
}

// ─── Auth ─────────────────────────────────────────────

app.get('/login', (req, res) => {
  const state = generators.state();
  const nonce = generators.nonce();
  req.session.state = state;
  req.session.nonce = nonce;
  const url = oidcClient.authorizationUrl({
    scope: 'openid profile email',
    state: state,
    nonce: nonce
  });
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  try {
    const params = oidcClient.callbackParams(req);
    const tokenSet = await oidcClient.callback(
      'http://localhost:' + PORT + '/callback',
      params,
      { state: req.session.state, nonce: req.session.nonce }
    );
    req.session.tokenSet = {
      access_token: tokenSet.access_token,
      id_token: tokenSet.id_token,
      refresh_token: tokenSet.refresh_token
    };
    req.session.user = tokenSet.claims();
    res.redirect('/');
  } catch (e) {
    console.error('Callback error:', e.message);
    res.status(500).send('Authentication failed: ' + e.message);
  }
});

app.get('/logout', (req, res) => {
  const idToken = req.session.tokenSet ? req.session.tokenSet.id_token : null;
  req.session.destroy(() => {
    if (idToken) {
      const logoutUrl = KC_URL + '/realms/' + REALM + '/protocol/openid-connect/logout' +
        '?id_token_hint=' + idToken +
        '&post_logout_redirect_uri=http://localhost:' + PORT;
      return res.redirect(logoutUrl);
    }
    res.redirect('/');
  });
});

// ─── API: scope = el propio usuario ───────────────────

async function userApi(req, method, endpoint) {
  // Llamamos al Account REST API de Keycloak con el access_token del usuario
  const config = {
    method: method,
    url: KC_URL + '/realms/' + REALM + '/account' + endpoint,
    headers: {
      Authorization: 'Bearer ' + req.session.tokenSet.access_token,
      'Content-Type': 'application/json'
    }
  };
  const res = await axios(config);
  return res.data;
}

app.use('/api', requireAuth);

app.get('/api/me', async (req, res) => {
  try {
    const profile = await userApi(req, 'GET', '/');
    res.json({
      username: profile.username,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      emailVerified: profile.emailVerified,
      attributes: profile.attributes || {}
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/credentials', async (req, res) => {
  try {
    const data = await userApi(req, 'GET', '/credentials');
    // Account REST API devuelve un array con info de cada tipo de credential
    res.json(data);
  } catch (e) {
    console.error('GET /credentials error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/credentials/:id', async (req, res) => {
  try {
    await userApi(req, 'DELETE', '/credentials/' + req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Genera URL para que el usuario configure un nuevo método
// Esto redirige al Account Console nativo de Keycloak donde la ceremonia
// (TOTP QR, WebAuthn registration, recovery codes) ya está implementada
app.get('/api/setup-url/:type', (req, res) => {
  const type = req.params.type;
  const actionMap = {
    'totp': 'CONFIGURE_TOTP',
    'webauthn': 'webauthn-register',
    'recovery': 'CONFIGURE_RECOVERY_AUTHN_CODES',
    'password': 'UPDATE_PASSWORD'
  };
  const action = actionMap[type];
  if (!action) return res.status(400).json({ error: 'unknown type' });

  // URL que dispara la kc_action en Keycloak
  const url = KC_URL + '/realms/' + REALM + '/protocol/openid-connect/auth' +
    '?client_id=' + CLIENT_ID +
    '&redirect_uri=' + encodeURIComponent('http://localhost:' + PORT + '/') +
    '&response_type=code' +
    '&scope=openid' +
    '&kc_action=' + action;
  res.json({ url: url });
});

// ─── Frontend protegido ───────────────────────────────

app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/callback' || req.path === '/logout') return next();
  requireAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

initOidc().then(() => {
  app.listen(PORT, () => {
    console.log('AcmeCorp Self-Service Portal running on http://localhost:' + PORT);
    console.log('Open in browser to manage your own credentials');
  });
}).catch(e => {
  console.error('Failed to init OIDC:', e.message);
  process.exit(1);
});
