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

async function userApi(req, method, endpoint) {
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

async function userHasMfa(req) {
  try {
    const creds = await userApi(req, 'GET', '/credentials');
    const mfaTypes = ['otp', 'webauthn', 'webauthn-passwordless', 'recovery-authn-codes'];
    for (const c of creds) {
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
    return false;
  }
}

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

    const returnTo = req.session.returnTo;
    req.session.returnTo = null;

    const hasMfa = await userHasMfa(req);
    if (!hasMfa) {
      req.session.postSetupRedirect = returnTo || '/';
      return res.redirect('/welcome');
    }

    res.redirect(returnTo || '/');
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

// ─── Welcome page (first-login MFA method selector) ───

app.get('/welcome', requireAuth, async (req, res) => {
  const hasMfa = await userHasMfa(req);
  if (hasMfa) {
    const redirect = req.session.postSetupRedirect || '/';
    req.session.postSetupRedirect = null;
    return res.redirect(redirect);
  }
  res.sendFile(path.join(__dirname, 'public/welcome.html'));
});

// Endpoint that apps redirect to when they detect a user without MFA
// GET /gatekeeper?returnTo=http://localhost:3001
app.get('/gatekeeper', requireAuth, async (req, res) => {
  const returnTo = req.query.returnTo || '/';
  req.session.postSetupRedirect = returnTo;
  const hasMfa = await userHasMfa(req);
  if (hasMfa) {
    return res.redirect(returnTo);
  }
  res.redirect('/welcome');
});

// ─── API ──────────────────────────────────────────────

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
    res.json(data);
  } catch (e) {
    console.error('GET /credentials error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/has-mfa', async (req, res) => {
  const has = await userHasMfa(req);
  res.json({ hasMfa: has });
});

app.delete('/api/credentials/:id', async (req, res) => {
  try {
    await userApi(req, 'DELETE', '/credentials/' + req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

  const backTo = req.query.from === 'welcome'
    ? 'http://localhost:' + PORT + '/welcome'
    : 'http://localhost:' + PORT + '/';

  const url = KC_URL + '/realms/' + REALM + '/protocol/openid-connect/auth' +
    '?client_id=' + CLIENT_ID +
    '&redirect_uri=' + encodeURIComponent(backTo) +
    '&response_type=code' +
    '&scope=openid' +
    '&kc_action=' + action;
  res.json({ url: url });
});

// ─── Frontend ─────────────────────────────────────────

app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/callback' || req.path === '/logout' || req.path === '/welcome' || req.path === '/gatekeeper') return next();
  requireAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

initOidc().then(() => {
  app.listen(PORT, () => {
    console.log('AcmeCorp Self-Service Portal running on http://localhost:' + PORT);
    console.log('MFA selector available at /welcome for first-time users');
  });
}).catch(e => {
  console.error('Failed to init OIDC:', e.message);
  process.exit(1);
});
