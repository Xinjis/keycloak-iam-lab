const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const { Issuer, generators } = require('openid-client');

const app = express();
const PORT = 3003;
const KC_URL = process.env.KC_URL || 'http://localhost:8080';
const REALM = 'acmecorp';
const CLIENT_ID = 'acmecorp-admin-panel';
const CLIENT_SECRET = 'panel-secret-local';
const REQUIRED_ROLE = 'admin';

app.use(express.json());
app.use(session({
  secret: 'admin-panel-session-secret-change-in-prod',
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

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'not authenticated' });
  }
  const roles = req.session.user.realm_access ? req.session.user.realm_access.roles : [];
  if (!roles.includes(REQUIRED_ROLE)) {
    return res.status(403).send(
      '<div style="font-family:sans-serif;padding:40px;max-width:600px;margin:50px auto;text-align:center">' +
      '<h1 style="color:#dc2626">403 — Access Denied</h1>' +
      '<p>Your user does not have the required role (<code>admin</code>) to access this panel.</p>' +
      '<p>Logged in as: <strong>' + req.session.user.preferred_username + '</strong></p>' +
      '<p><a href="/logout">Log out</a></p>' +
      '</div>'
    );
  }
  next();
}

// ─── Auth endpoints ──────────────────────────────────────

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
    // Merge claims from id_token AND access_token (roles live in access_token)
    const idClaims = tokenSet.claims();
    const accessPayload = JSON.parse(
      Buffer.from(tokenSet.access_token.split('.')[1], 'base64').toString()
    );
    req.session.user = Object.assign({}, idClaims, {
      realm_access: accessPayload.realm_access || { roles: [] },
      resource_access: accessPayload.resource_access || {}
    });
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

// ─── Service account token para llamar a la admin API ────

let cachedSvcToken = null;
let svcTokenExpiry = 0;

async function getServiceToken() {
  if (cachedSvcToken && Date.now() < svcTokenExpiry - 5000) return cachedSvcToken;
  const res = await axios.post(
    KC_URL + '/realms/' + REALM + '/protocol/openid-connect/token',
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  );
  cachedSvcToken = res.data.access_token;
  svcTokenExpiry = Date.now() + res.data.expires_in * 1000;
  return cachedSvcToken;
}

async function kcApi(method, endpoint, data) {
  const token = await getServiceToken();
  const config = {
    method: method,
    url: KC_URL + '/admin/realms/' + REALM + endpoint,
    headers: { Authorization: 'Bearer ' + token }
  };
  if (data) config.data = data;
  const res = await axios(config);
  return res.data;
}

// ─── API protegida ───────────────────────────────────────

app.use('/api', requireAuth, requireAdmin);

app.get('/api/me', (req, res) => {
  res.json({
    username: req.session.user.preferred_username,
    email: req.session.user.email,
    roles: req.session.user.realm_access ? req.session.user.realm_access.roles : []
  });
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await kcApi('GET', '/users?briefRepresentation=false&max=100');
    const usersWithCreds = await Promise.all(users.map(async (u) => {
      try {
        const creds = await kcApi('GET', '/users/' + u.id + '/credentials');
        const roles = await kcApi('GET', '/users/' + u.id + '/role-mappings/realm');
        return {
          id: u.id,
          username: u.username,
          email: u.email || '',
          firstName: u.firstName || '',
          lastName: u.lastName || '',
          enabled: u.enabled,
          emailVerified: u.emailVerified,
          createdTimestamp: u.createdTimestamp,
          attributes: u.attributes || {},
          credentials: creds.map(c => ({
            id: c.id, type: c.type, userLabel: c.userLabel, createdDate: c.createdDate
          })),
          roles: roles.map(r => r.name).filter(r => !r.startsWith('default-')),
          federated: !!(u.attributes && u.attributes.LDAP_ENTRY_DN)
        };
      } catch (e) {
        return { id: u.id, username: u.username, credentials: [], roles: [], error: e.message };
      }
    }));
    res.json(usersWithCreds);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const users = await kcApi('GET', '/users?max=10000');
    res.json({
      totalUsers: users.length,
      enabledUsers: users.filter(u => u.enabled).length,
      ldapUsers: users.filter(u => u.attributes && u.attributes.LDAP_ENTRY_DN).length,
      localUsers: users.filter(u => !u.attributes || !u.attributes.LDAP_ENTRY_DN).length,
      verifiedEmails: users.filter(u => u.emailVerified).length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/users/:id/credentials/:credId', async (req, res) => {
  try {
    await kcApi('DELETE', '/users/' + req.params.id + '/credentials/' + req.params.credId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:id/required-actions', async (req, res) => {
  try {
    await kcApi('PUT', '/users/' + req.params.id, { requiredActions: req.body.actions });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:id/logout', async (req, res) => {
  try {
    await kcApi('POST', '/users/' + req.params.id + '/logout');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id/toggle', async (req, res) => {
  try {
    await kcApi('PUT', '/users/' + req.params.id, { enabled: req.body.enabled });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Frontend protegido ──────────────────────────────────

app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/callback' || req.path === '/logout') return next();
  requireAuth(req, res, () => requireAdmin(req, res, next));
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Boot ────────────────────────────────────────────────

initOidc().then(() => {
  app.listen(PORT, () => {
    console.log('AcmeCorp Admin Panel — http://localhost:' + PORT);
    console.log('Auth required: rol "' + REQUIRED_ROLE + '"');
  });
}).catch(e => {
  console.error('Failed to init OIDC:', e.message);
  process.exit(1);
});
