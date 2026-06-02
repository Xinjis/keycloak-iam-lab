<div align="center">

# Keycloak Enterprise IAM Lab

**A production-grade Identity & Access Management laboratory built from scratch.**  
Keycloak 23 · OpenLDAP · OAuth2/OIDC · SAML 2.0 · SSO · JWT · RS256

[![Keycloak](https://img.shields.io/badge/Keycloak-23.0.6-4CAF50?style=flat-square&logo=keycloak&logoColor=white)](https://www.keycloak.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

*Built as a hands-on training environment for enterprise IAM consulting projects.*  
*Every decision documented. Every problem solved and explained.*

</div>

---

## What is this?

This is not a "hello world" Keycloak tutorial.

This lab simulates the IAM architecture of a real enterprise client — the kind you encounter in digital transformation projects at large consulting firms. The fictional company **AcmeCorp** needs to centralize identity for its employees, federate their existing Active Directory, protect modern web apps and APIs with SSO, enforce MFA for privileged users, and harden the configuration to meet ISO 27001 and ENS (Spain's National Security Framework) requirements.

Everything here was built incrementally, hit real problems (macOS ARM compatibility, Keycloak 23 API changes, Docker networking edge cases), and those problems are documented with their solutions.

**If you work in IAM, security consulting, or enterprise architecture, this lab covers what you actually need to know.**

---

## Architecture

```
╔══════════════════════════════════════════════════════════════════════╗
║                     IDENTITY SOURCES                                 ║
║                                                                      ║
║   ┌─────────────────────┐      ┌──────────────────────────────┐     ║
║   │     OpenLDAP        │      │    External Identity          │     ║
║   │  (simulates AD)     │      │    Providers                  │     ║
║   │                     │      │  (Azure AD, Google, SAML IdP) │     ║
║   │  ou=IT              │      └──────────────┬───────────────┘     ║
║   │  └── ldap.jdoe      │                     │                     ║
║   │  ou=Finance         │                     │ Identity Brokering   ║
║   │  └── ldap.msmith    │                     │ (OIDC / SAML)        ║
║   └──────────┬──────────┘                     │                     ║
║              │ User Federation                │                     ║
║              │ (sync + attribute mappers)     │                     ║
╚══════════════╪═════════════════════════════════╪════════════════════╝
               │                               │
               ▼                               ▼
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║                     KEYCLOAK 23.0.6                                  ║
║                  Central Identity Provider                           ║
║                                                                      ║
║   ┌──────────────────────────────────────────────────────────────┐  ║
║   │  Realm: acmecorp                                             │  ║
║   │                                                              │  ║
║   │  Authentication          Authorization         Token Engine  │  ║
║   │  ─────────────           ─────────────         ────────────  │  ║
║   │  Password + MFA          RBAC / ABAC           JWT / RS256   │  ║
║   │  LDAP Federation         Roles & Groups        JWKS endpoint │  ║
║   │  Identity Brokering      Fine-grained AuthZ    Token TTL     │  ║
║   │  Brute Force Protection  Client Scopes         Introspection │  ║
║   └──────────────────────────────────────────────────────────────┘  ║
║                                                                      ║
║   Backend: PostgreSQL 15 (production-grade, not H2)                  ║
╚══════════════════════════════════════════════════════════════════════╝
               │
               │  Issues signed JWT tokens (RS256)
               │
       ┌───────┴──────────────────────────────────┐
       │                                          │
       ▼                                          ▼
╔══════════════════╗   ╔══════════════════╗   ╔═══════════════════════╗
║   Portal App     ║   ║   Finance App    ║   ║   Backend API         ║
║   (Node.js)      ║   ║   (Node.js)      ║   ║   (bearer-only)       ║
║   port: 3001     ║   ║   port: 3002     ║   ║                       ║
║                  ║   ║                  ║   ║  Validates JWT locally ║
║  Auth Code Flow  ║   ║  Auth Code Flow  ║   ║  via JWKS endpoint    ║
║  + PKCE          ║   ║  + PKCE          ║   ║                       ║
╚══════════════════╝   ╚══════════════════╝   ╚═══════════════════════╝
       └─────────────────────┘
         SSO — one login, all apps
         SLO — one logout, closes all
```

---

## The Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Identity Provider | Keycloak | 23.0.6 | Central IdP — auth, authz, token issuance |
| Database | PostgreSQL | 15 | Persistent storage (never H2 in real projects) |
| Directory | OpenLDAP | 1.5.0 | Simulates corporate Active Directory |
| Directory UI | phpLDAPadmin | 0.9.0 | Visual LDAP browser |
| Mail capture | MailHog | latest | Captures verification emails |
| Demo apps | Node.js | 18+ | SSO demo — portal and finance apps |
| Scripts | Python | 3.10+ | Token analysis and automation |
| Protocol (auth) | OAuth2 + OIDC | — | Modern authentication and authorization |
| Protocol (legacy) | SAML 2.0 | — | Enterprise legacy system integration |
| Token algorithm | RS256 | — | Asymmetric JWT signing |

---

## Cryptography Foundation

*Understanding this section is what separates a consultant from a technician.*

### Why asymmetric cryptography (RS256)?

JWT tokens need to be verifiable by any service that receives them — APIs, microservices, API gateways. There are two approaches:

```
SYMMETRIC (HS256):
  One secret key → used to BOTH sign and verify
  
  Keycloak ──(signs with secret)──► JWT
  API      ◄──(verifies with same secret)── JWT
  
  Problem: Every service that verifies tokens must know the secret.
  If any service is compromised → attacker can forge valid tokens.
  Only viable when Keycloak and all APIs are under the same team's control.


ASYMMETRIC (RS256):                          ← what this lab uses
  Private key → signs (only Keycloak has this, never leaves the server)
  Public key  → verifies (published openly at the JWKS endpoint)
  
  Keycloak ──(signs with PRIVATE key)──► JWT
  API      ◄──(verifies with PUBLIC key)── JWT
  
  The public key is available to anyone:
  GET /realms/acmecorp/protocol/openid-connect/certs
  
  With the public key you can ONLY verify — never forge.
  Even if an API is compromised, attackers cannot create valid tokens.
  This is the correct pattern for distributed microservice architectures.
```

### How Keycloak signs a JWT

```
INPUT: claims about the user
  {
    "sub": "uuid-of-user",
    "preferred_username": "jdoe",
    "realm_access": { "roles": ["user", "it-admin"] },
    "exp": 1748370000,
    ...
  }

STEP 1: Build the header
  { "alg": "RS256", "typ": "JWT", "kid": "key-id-abc123" }
  → Base64URL encode → eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImFiYzEyMyJ9

STEP 2: Build the payload
  { all claims above }
  → Base64URL encode → eyJzdWIiOiJ1dWlkLW9mLXVzZXIiLCAuLi59

STEP 3: Create the signing input
  signing_input = header_b64 + "." + payload_b64

STEP 4: Sign with RSA private key
  signature = RSA_sign( SHA256(signing_input), private_key )
  → Base64URL encode → SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c

STEP 5: Assemble the JWT
  JWT = header_b64 + "." + payload_b64 + "." + signature_b64
      = eyJhbGci....eyJzdWIi....SflKxwRJS
        ─────────   ─────────   ──────────
          header     payload    signature
```

### How an API verifies the JWT

```
API receives: eyJhbGci....eyJzdWIi....SflKxwRJS

STEP 1: Split by "." → 3 parts
STEP 2: Read "kid" from header → "key-id-abc123"
STEP 3: Fetch public key from JWKS (cached with TTL):
        GET /realms/acmecorp/protocol/openid-connect/certs
        → find the key where kid = "key-id-abc123"
STEP 4: Verify signature:
        expected_hash = RSA_decrypt( signature, public_key )
        actual_hash   = SHA256( header_b64 + "." + payload_b64 )
        
        expected_hash == actual_hash ?  ✅ VALID  :  ❌ REJECT
        
STEP 5: Check standard claims:
        exp > now()    ?  ✅ not expired
        iss == realm   ?  ✅ correct issuer
        aud contains API ? ✅ correct audience

RESULT: Token accepted or rejected — zero calls to Keycloak required.
```

**The tamper-proof guarantee:** If an attacker modifies even one byte of the payload (e.g., adds `"admin"` to the roles), the `actual_hash` of the modified payload will be completely different from the `expected_hash` embedded in the signature. Rejection is guaranteed. Without Keycloak's private key, generating a valid signature for a modified payload is computationally infeasible.

---

## OAuth2 / OIDC Flows

### Authorization Code Flow + PKCE

*The correct pattern for any app with a human user.*

```
  Browser / App              App Server              Keycloak
       │                         │                      │
       │── GET /dashboard ───────►│                      │
       │                         │  No session found     │
       │                         │  Generate PKCE:       │
       │                         │  code_verifier=random │
       │                         │  code_challenge=      │
       │                         │    SHA256(verifier)   │
       │                         │  state=random (CSRF)  │
       │◄── redirect to Keycloak ─┤                      │
       │                         │                      │
       │── GET /auth?                                    │
       │    response_type=code                           │
       │    client_id=acmecorp-portal                    │
       │    code_challenge=<hash>   ───────────────────►│
       │    state=<random>                               │
       │                                                 │
       │◄─────────────── Login page ────────────────────│
       │── POST credentials ──────────────────────────►│
       │◄─────────── redirect /callback?code=ABC123 ───│
       │                    &state=<same>               │
       │                         │                      │
       │── GET /callback?code=ABC123 ──►│               │
       │                         │  Verify state ✅     │
       │                         │── POST /token ──────►│
       │                         │   code=ABC123        │
       │                         │   code_verifier=...  │
       │                         │   client_secret=...  │
       │                         │◄── access_token ─────│
       │                         │    refresh_token      │
       │                         │    id_token          │
       │◄── Session established ─┤                      │
       │                         │                      │
```

**Why two steps (code → token)?**

The `code` travels through the browser (front-channel) — it appears in URLs, browser history, and server logs. It's intentionally short-lived (60s, single use).

The token exchange happens server-to-server (back-channel) — never visible to the user or in browser history. This is where the `client_secret` and `code_verifier` are used.

**What PKCE adds:**

Without PKCE, on mobile apps (no `client_secret`), an attacker who intercepts the `code` in the redirect can exchange it for tokens directly. With PKCE, the `code` is useless without the `code_verifier` that never left the originating device.

```
Without PKCE:  intercept code → POST /token {code} → ✅ tokens stolen
With PKCE:     intercept code → POST /token {code, code_verifier=?} → ❌ rejected
```

### The three OIDC tokens

```
┌─────────────────────────────────────────────────────────────┐
│  ACCESS TOKEN                                               │
│  ─────────────────────────────────────────────────────────  │
│  Who uses it:  APIs and resource servers                    │
│  Purpose:      Authorize API calls                          │
│  Contains:     sub, roles, scope, iss, aud (the API), exp   │
│  Sent as:      Authorization: Bearer <token>                │
│  TTL:          Short — 300s in this lab (5 minutes)         │
│  Rule:         APIs validate it, users never see it         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ID TOKEN                                                   │
│  ─────────────────────────────────────────────────────────  │
│  Who uses it:  The application (client)                     │
│  Purpose:      Identify who the user is                     │
│  Contains:     sub, name, email, picture, nonce             │
│  aud:          The client_id (not the API)                  │
│  Rule:         App reads it, never sent to APIs             │
│  Key claim:    sub — the canonical user identifier          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  REFRESH TOKEN                                              │
│  ─────────────────────────────────────────────────────────  │
│  Who uses it:  The application, to renew the access token   │
│  Purpose:      Silent token renewal without re-login        │
│  TTL:          Long — hours or days                         │
│  Rotation:     Each use invalidates the previous one        │
│  Rule:         Only sent to /token endpoint, never to APIs  │
└─────────────────────────────────────────────────────────────┘
```

### The JWT logout gap

One of the most important security considerations when using JWTs:

```
  t=0s    User logs in → access_token issued (TTL: 300s)
  t=10s   User logs out → Keycloak session invalidated
  t=30s   Attacker uses stolen access_token
  t=30s   API validates JWT locally → signature ✅, exp ✅ → ACCEPTED ⚠️
  t=30s   Introspection → active: false → REJECTED ✅
  t=300s  Token finally expires → API rejects it
```

**The 290-second window is a real risk.** Mitigation strategies:

| Strategy | Protection | Overhead | Use case |
|----------|-----------|----------|----------|
| Short TTL (300s) | Limits window | None | Standard apps |
| Introspection on every request | Immediate | ~10ms/req | Banking, healthcare |
| Backchannel logout | Immediate | Implementation cost | Regulatory requirements |
| Opaque tokens | Immediate | Always needs introspection | Maximum security |

---

## JWT Anatomy

A real decoded token from this lab:

```json
{
  "exp": 1748370000,              ← Unix timestamp expiry
  "iat": 1748369700,              ← Unix timestamp issued (exp-iat = 300s TTL)
  "jti": "unique-token-id",       ← JWT ID — for blacklisting specific tokens
  "iss": "http://localhost:8080/realms/acmecorp",  ← Issuer — API MUST verify this
  "aud": "account",               ← Audience — API MUST verify it appears here
  "sub": "3ad53cff-b218-4934",    ← Subject — CANONICAL user ID
                                    USE THIS as FK in your database
                                    Never email or username (those can change)
  "azp": "acmecorp-portal",       ← Authorized party — which client requested this
  "sid": "19133a43-9446-4e91",    ← Session ID — same across all SSO apps
  "acr": "1",                     ← Auth level: "1"=password, "2"=MFA completed
  "realm_access": {
    "roles": ["user", "it-admin"] ← Global roles — valid across all apps
  },
  "resource_access": {
    "acmecorp-api": {
      "roles": ["viewer"]         ← Client-specific roles — only for this API
    }
  },
  "scope": "openid email profile",
  "preferred_username": "jdoe",   ← Can change — do not use as FK
  "email": "jdoe@acmecorp.local",
  "department": "IT",             ← Custom claim — added via Protocol Mapper
  "employee_id": "EMP-001"        ← Custom claim — mapped from LDAP attribute
}
```

---

## SSO — Single Sign-On

*One authentication, unlimited applications.*

### How the SSO session cookie works

```
FIRST APP — user has no session:

  Browser → Portal (3001): GET /dashboard
  Portal: no local session → redirect to Keycloak
  Keycloak: no SSO cookie → show login form
  User: enters credentials (+ MFA if configured)
  Keycloak: creates SSO session → sets cookie on keycloak domain
  Keycloak: issues tokens → redirect to Portal
  Portal: establishes local session


SECOND APP — SSO cookie exists:

  Browser → Finance (3002): GET /reports
  Finance: no local session → redirect to Keycloak
  Keycloak: finds SSO cookie ✅ → user already authenticated
  Keycloak: issues tokens → redirect to Finance
  Finance: establishes local session
  User never sees a login form.


LOGOUT — global session termination:

  User logs out from Portal
  Portal: destroys local session
  Portal: calls Keycloak end_session_endpoint with id_token_hint
  Keycloak: invalidates SSO session (destroys SSO cookie)
  Keycloak (backchannel): notifies Finance app → Finance destroys its session
  Result: user is logged out everywhere
```

---

## What This Lab Covers

### Module 1 — Enterprise Realm Setup
- Keycloak with PostgreSQL (H2 is for demos, PostgreSQL is for real work)
- Complete realm configuration: password policy, brute force protection, session management
- 4 client types correctly configured for their use case
- Roles, groups, and test users with business attributes

### Module 2 — LDAP / Active Directory Federation
- Keycloak federated with OpenLDAP (simulating corporate AD)
- Group mappers: LDAP groups → Keycloak groups
- Attribute mappers: `departmentNumber`, `employeeNumber` → JWT claims
- Users organized in OUs by department (IT, Finance)

### Module 3 — OAuth2 / OIDC Deep Dive
- Authorization Code Flow + PKCE (interactive apps)
- Client Credentials grant (M2M services)
- Refresh Token with rotation
- JWT token anatomy and validation
- Logout gap demonstration with introspection

### Module 4 — SSO Multi-Application
- 2 Node.js apps with real SSO
- Single login, both apps accessible
- Global logout via `end_session_endpoint`
- Session ID verification across apps

### Module 5 — Cryptography Applied
- Live JWKS endpoint inspection
- JWT forgery attempt (demonstrating why it fails)
- RS256 vs HS256 — architectural implications
- Token signature verification

### Module 6 — Security Hardening
- Password policy (complexity, history, expiration)
- Brute force protection
- Session lifetime management
- HTTP security headers
- Mapping to ISO 27001 controls and ENS requirements

---

## Quick Start

### Prerequisites

```bash
docker --version          # Docker 20+
docker compose version    # Docker Compose v2
python3 --version         # Python 3.10+
node --version            # Node.js 18+
```

> **macOS ARM (M1/M2/M3):** Read [docs/macos-arm-setup.md](docs/macos-arm-setup.md) first.

### Start the stack

```bash
git clone https://github.com/Xinjis/keycloak-iam-lab.git
cd keycloak-iam-lab

# Copy environment file
cp .env.example .env

# Start all services
docker compose up -d

# Wait ~60-90s for Keycloak to initialize, then verify
curl -s http://localhost:8080/health/ready | python3 -m json.tool
```

### Configure the lab

```bash
# Step 1: Create realm, clients, roles, users
bash scripts/01_setup_realm.sh

# Step 2: Load LDAP data (users and groups)
bash scripts/02_load_ldap.sh
```

### Verify everything works

```bash
# Get a real JWT and decode it
python3 scripts/decode_token.py

# Compare all OAuth2 grant types
python3 scripts/get_token.py

# Demonstrate the JWT logout gap
python3 scripts/demo_logout_gap.py
```

### Access the services

| Service | URL | Credentials |
|---------|-----|-------------|
| **Keycloak Admin** | http://localhost:8080/admin | admin / Admin1234! |
| **Account Console** | http://localhost:8080/realms/acmecorp/account | jdoe / Test1234! |
| **phpLDAPadmin** | http://localhost:8090 | cn=admin,dc=acmecorp,dc=local |
| **MailHog** | http://localhost:8025 | — |
| **Portal App (SSO)** | http://localhost:3001 | jdoe / Test1234! |
| **Finance App (SSO)** | http://localhost:3002 | SSO — no login needed |

### Start the SSO demo apps

```bash
# Install dependencies
cd apps/portal && npm install
cd ../finance && npm install

# Start both apps
cd ~/keycloak-iam-lab
node apps/portal/server.js &
node apps/finance/server.js &

# Open http://localhost:3001 → login → then open http://localhost:3002
# The Finance app should open without asking for credentials
```

---

## Test Users

| Username | Password | Roles | Department | Notes |
|----------|----------|-------|------------|-------|
| `jdoe` | Test1234! | user, it-admin | IT | Local Keycloak user |
| `msmith` | Test1234! | user, finance-viewer | Finance | Local Keycloak user |
| `itadmin` | Admin1234! | admin | — | Admin account |
| `ldap.jdoe` | Test1234! | via LDAP groups | IT | Federated from OpenLDAP |
| `ldap.msmith` | Test1234! | via LDAP groups | Finance | Federated from OpenLDAP |

---

## Repository Structure

```
keycloak-iam-lab/
│
├── docker-compose.yml              # Full stack definition
├── .env.example                    # Environment variables template
├── .gitignore
├── LICENSE
│
├── ldap/
│   └── bootstrap/
│       ├── 01-structure.ldif       # OUs and org structure
│       ├── 02-users.ldif           # Test users with attributes
│       └── 03-groups.ldif          # Groups and memberships
│
├── scripts/
│   ├── 01_setup_realm.sh           # Realm, clients, roles, users
│   ├── 02_load_ldap.sh             # Load LDIF data into OpenLDAP
│   ├── get_token.py                # All OAuth2 grant types demonstrated
│   ├── decode_token.py             # Full JWT analysis tool
│   └── demo_logout_gap.py          # JWT logout gap demonstration
│
├── apps/
│   ├── portal/                     # Employee Portal — SSO demo (port 3001)
│   │   ├── server.js               # Express + openid-client
│   │   └── package.json
│   └── finance/                    # Finance App — SSO demo (port 3002)
│       ├── server.js
│       └── package.json
│
└── docs/
    ├── macos-arm-setup.md          # Apple Silicon specific setup
    └── troubleshooting.md          # Real problems and solutions
```

---

## Architecture Decisions

**Why PostgreSQL instead of H2?**

Keycloak ships with H2 as the default embedded database. H2 is volatile (data lost on restart), doesn't support clustering, and behaves differently from production databases. Using H2 in "just a dev environment" is how teams discover problems the week before go-live. PostgreSQL from day one means the behavior is identical across all environments.

**Why RS256 instead of HS256?**

HS256 uses a symmetric key — the same secret signs and verifies tokens. Any service that can verify tokens can also forge them. In a microservices architecture with dozens of independent services, this means a single compromised service can mint valid tokens for any user. RS256 uses asymmetric keys: Keycloak signs with its private key (never shared), services verify with the public key (freely available at the JWKS endpoint). Compromise of any service cannot lead to token forgery.

**Why 300-second access token TTL?**

A stolen access token (from XSS, log exposure, or a compromised service) is valid until it expires. The default Keycloak TTL is 5 minutes for access tokens — reducing this to 300s limits the attack window to 5 minutes. Paired with short-TTL refresh token rotation, this provides a reasonable security/UX balance for most enterprise applications.

**Why PKCE on all interactive flows?**

OAuth 2.1 makes PKCE mandatory for all clients. The reason: on mobile applications, URL schemes can be registered by malicious apps to intercept authorization redirects. PKCE ensures that even if the `code` is intercepted, it's useless without the `code_verifier` that was generated on the legitimate client and never transmitted over the network.

**Why load LDAP data manually instead of bind-mounting bootstrap LDIFs?**

The `osixia/openldap` image removes its bootstrap directory after processing it during container initialization. On macOS Docker Desktop, this `rm -rf` operation fails on bind-mounted directories because the host OS prevents containers from deleting mounted volumes. The solution is to start OpenLDAP without bootstrap mounts and load the LDIF files via `docker cp` + `ldapadd` after the container is running. This is documented in [docs/macos-arm-setup.md](docs/macos-arm-setup.md).

---

## Known Issues and Solutions

See [docs/troubleshooting.md](docs/troubleshooting.md) for detailed solutions to:

- OpenLDAP exits immediately on macOS ARM with Docker Desktop
- `kcadm.sh set-password --temporary false` fails on Keycloak 23
- Client not allowed for direct access grants
- Keycloak Admin Console rejects non-master realm users
- Container name conflicts when restarting the stack

---

## Standards Coverage

This lab's hardening configuration maps to:

| Control | Standard | Implementation |
|---------|----------|---------------|
| Access Control | ISO 27001 A.9.4 | Password policy, brute force, session limits |
| Authentication | ISO 27001 A.9.4.2 | MFA via TOTP, account lockout |
| Session Management | ISO 27001 A.9.4.2 | Idle timeout, max lifespan |
| Audit Logging | ISO 27001 A.12.4 | Event logging, SIEM-ready format |
| Secure Transmission | ISO 27001 A.13.2 | TLS enforcement via `sslRequired` |
| Authentication Strength | ENS mp.access.3 | MFA for privileged users |
| Attempt Limiting | ENS mp.access.5 | Brute force protection |
| HTTP Security | OWASP ASVS 2.1 | CSP, HSTS, X-Frame-Options headers |

---

## References

- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [OAuth 2.0 — RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [OAuth 2.1 — Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [PKCE — RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [JWT — RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)
- [JWK — RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517)
- [ENS — Real Decreto 311/2022](https://www.boe.es/eli/es/rd/2022/05/03/311)

---

## License

MIT — use it, modify it, share it.

---

<div align="center">

Built as part of a hands-on IAM training program for enterprise security consulting.  
*Every problem in the troubleshooting guide happened in real life.*

</div>
