<div align="center">

# Keycloak Enterprise IAM Lab

**A production-grade Identity & Access Management laboratory built from scratch.**
Keycloak 23 · OpenLDAP · OAuth2/OIDC · SAML 2.0 · SSO · MFA · WebAuthn · JWT · RS256

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

This lab simulates the IAM architecture of a real enterprise client — the kind you encounter in digital transformation projects at large consulting firms. The fictional company **AcmeCorp** needs to centralize identity for its employees, federate their existing Active Directory, protect modern web apps and APIs with SSO, enforce multi-factor authentication for every user, give each one self-service control over their credentials, and harden the configuration to meet ISO 27001 and ENS (Spain's National Security Framework) requirements.

Everything here was built incrementally, hit real problems (macOS ARM compatibility, Keycloak 23 API changes, Docker networking edge cases, authentication flow quirks), and those problems are documented with their solutions.

**If you work in IAM, security consulting, or enterprise architecture, this lab covers what you actually need to know.**

---

## Multi-Factor Authentication — Universal Enforcement

*Four methods. User chooses. Admin governs. Self-service enabled. Compliance-aligned.*

This lab implements the full enterprise MFA pattern that real consulting projects deliver to clients — not the toy "let's enable TOTP for admins" demo. The authentication design follows the **ENS** and **ISO 27001** requirements that mandate strong authentication for **all users** with access to corporate resources, not just privileged ones.

### Why universal MFA, not role-based

A common first instinct is to apply MFA only to administrators. Any auditor under ENS or ISO 27001 will flag that configuration:

```
Authentication ≠ Authorization

MFA proves WHO the user is — this must apply to everyone.
RBAC decides WHAT they can do — that's where roles matter.

An attacker who compromises a regular user's account has already
established a foothold inside the corporate network. From there:
  → lateral movement
  → credential harvesting
  → session token theft
  → privilege escalation
```

The right control is universal MFA at authentication time, plus strict RBAC at authorization time.

### The four authentication methods

```
┌─────────────────────────────────────────────────────────────────┐
│  PASSWORD                                                       │
│  Algorithm: bcrypt + salt                                       │
│  Purpose:   First factor, always required                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  TOTP (Time-based One-Time Password — RFC 6238)                 │
│  Algorithm: HMAC-SHA1(secret, floor(unix_time / 30))            │
│  Strength:  Medium (phishing-prone via proxy MITM)              │
│  Apps:      Google Authenticator, FreeOTP, Microsoft, Authy     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  WebAuthn (W3C / FIDO2)                                         │
│  Algorithm: ES256 / RS256 asymmetric                            │
│  Strength:  Very high — NIST AAL3, phishing-resistant           │
│  Variants:                                                      │
│    PLATFORM       Touch ID, Face ID, Windows Hello              │
│    CROSS-PLATFORM YubiKey, Titan Security Key                   │
│    SYNCED         iCloud Passkeys, Google Password Manager      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Recovery Codes                                                 │
│  Implementation: 12 random one-time codes                       │
│  Purpose:        Backup for "I lost my phone and security key"  │
│  Best practice:  Print and store in safe / password manager     │
└─────────────────────────────────────────────────────────────────┘
```

### Why WebAuthn over TOTP

WebAuthn isn't just "TOTP with biometrics." It solves a fundamentally different problem: **phishing resistance via origin binding.**

```
TOTP attack flow:
  Phishing site copies the real login form
  User enters credentials + 6-digit code
  Phishing site proxies them to the real site within 30 seconds
  Real site accepts everything → attacker has full access ❌

WebAuthn attack flow:
  Phishing site copies the real login form
  Browser launches WebAuthn ceremony with phishing origin
  Authenticator refuses to sign — origin doesn't match registration
  No code to copy, no way to relay → attacker blocked ✅
```

This is why NIST SP 800-63B classifies WebAuthn as **AAL3** (highest assurance) and TOTP only as **AAL2**.

### The authentication flow

The custom Authentication Flow `acmecorp-browser-mfa` enforces password + second factor for every user, presenting a method selector at login:

```
acmecorp-browser-mfa
├── Cookie (ALTERNATIVE)
├── Identity Provider Redirector (ALTERNATIVE)
└── Forms (ALTERNATIVE)
    ├── Username Password Form (REQUIRED)
    └── Conditional OTP (CONDITIONAL)
        ├── Condition - User Configured (REQUIRED)
        ├── OTP Form (ALTERNATIVE)
        ├── WebAuthn Authenticator (ALTERNATIVE)
        └── Recovery Authentication Code (ALTERNATIVE)
```

The `Condition - User Configured` step ensures the second factor is requested when the user has any 2FA method registered. New users are routed through a `CONFIGURE_TOTP` Required Action that forces 2FA setup on their first login, so the MFA universality is preserved across the user lifecycle.

The combination `REQUIRED parent + ALTERNATIVE children` creates the method selector. At login, users see all the methods they have configured and choose which one to use.

---

## The Admin Panel — Centralized Credential Governance

*Port 3003 — for IT administrators only.*

The admin panel is a custom Node.js + Alpine.js application that provides what security operations teams actually need on a daily basis, with a workflow optimized for credential governance and MFA enforcement.

### What it does

```
DASHBOARD
  ├── Total users, enabled / disabled
  ├── LDAP federated vs local
  └── Email-verified count

USER LIST
  ├── All users with their configured 2FA methods (color-coded badges)
  ├── Filters: by name, by method, LDAP vs local, with/without 2FA
  └── One-click "Manage" per user

PER-USER ACTIONS
  ├── View all credentials with creation dates
  ├── Remove specific credential
  ├── Force action on next login (password reset, TOTP, WebAuthn, recovery)
  ├── Force logout of all active sessions
  └── Enable / disable user account
```

### Architecture — two tokens, two purposes

The panel uses **two OAuth2 flows simultaneously**, and understanding why matters:

```
┌─────────────────────────────────────────────────────────────────┐
│  Authorization Code Flow (the human admin)                      │
│  Purpose:  Authenticate the IT admin who opens the panel        │
│  Carries:  realm_access.roles (must include 'admin')            │
│  Lifetime: Session cookie, 30 minutes idle                      │
│  Use:      Authorize entry to the panel UI                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Client Credentials Flow (the panel as a service)               │
│  Purpose:  Call the Keycloak Admin REST API                     │
│  Carries:  realm-management roles                               │
│  Use:      Backend operations on behalf of any user             │
└─────────────────────────────────────────────────────────────────┘
```

**Why this separation matters:**

If we used only the admin's user token for API calls:
- Every admin would need elevated permissions on their user account
- Tokens expire (5 min default) and would break long admin sessions
- Audit logs would show users doing admin operations, not the panel

With the separation:
- Permissions live on the panel's service account, not on individual users
- The panel knows who clicked what (session cookie) AND has the right permissions (service token)
- Standard pattern in any enterprise admin console

---

## The Self-Service Portal — User Empowerment

*Port 3004 — for any authenticated user.*

The self-service portal is the user-facing counterpart to the admin panel. Same stack, opposite scope: each user only sees and manages **their own** credentials.

### How user isolation is guaranteed

The portal uses the **Keycloak Account REST API**, which is fundamentally different from the Admin REST API:

```
Account REST API: GET /realms/acmecorp/account/credentials
  ✓ Requires user's own access_token
  ✓ Returns ONLY the token owner's credentials
  ✓ Impossible to query other users — the API itself enforces it
```

The portal never sees data belonging to other users. The isolation is enforced at the Keycloak level, not at the application level.

### The kc_action redirect — why we don't reinvent ceremonies

When the user clicks "Set up TOTP" or "Set up Passkey," the portal redirects to Keycloak with a special parameter:

```
http://localhost:8080/realms/acmecorp/protocol/openid-connect/auth
  ?client_id=acmecorp-self-service
  &kc_action=CONFIGURE_TOTP
```

The `kc_action` parameter tells Keycloak: "execute this required action now, then send the user back." This delegates the setup ceremony entirely to Keycloak's native screens:

- TOTP: QR rendering, secret generation, time-window sync
- WebAuthn: challenge generation, `navigator.credentials.create()`, attestation verification
- Recovery Codes: secure random generation, display, confirmation

We don't reimplement any of this. The portal provides the consolidated view; Keycloak handles the registration mechanics.

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
╚══════════════╪═════════════════════════════════╪════════════════════╝
               │                               │
               ▼                               ▼
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║                     KEYCLOAK 23.0.6                                  ║
║                  Central Identity Provider                           ║
║                                                                      ║
║   Authentication               Authorization                         ║
║   ─────────────────             ─────────────────                    ║
║   Password (always)             RBAC / ABAC                          ║
║   TOTP (RFC 6238)               Roles & Groups                       ║
║   WebAuthn (FIDO2)              Fine-grained AuthZ                   ║
║   Recovery Codes                Client Scopes                        ║
║   LDAP Federation                                                    ║
║   Identity Brokering            Token Engine                         ║
║   Universal MFA enforcement     ─────────────────                    ║
║   Brute Force Protection        JWT / RS256                          ║
║                                 JWKS endpoint                        ║
║                                 Token TTL + Introspection            ║
║                                                                      ║
║   Backend: PostgreSQL 15                                             ║
╚══════════════════════════════════════════════════════════════════════╝
               │
               │  Issues signed JWT tokens (RS256)
               │
       ┌───────┴────────────┬───────────────┬──────────────────┐
       │                    │               │                  │
       ▼                    ▼               ▼                  ▼
╔══════════════╗   ╔══════════════╗  ╔═══════════════╗  ╔══════════════╗
║  Portal      ║   ║  Finance     ║  ║  Admin Panel  ║  ║ Self-Service ║
║  :3001       ║   ║  :3002       ║  ║  :3003        ║  ║ :3004        ║
║              ║   ║              ║  ║               ║  ║              ║
║  SSO demo    ║   ║  SSO demo    ║  ║ Manage all    ║  ║ Each user    ║
║  Auth Code   ║   ║  Auth Code   ║  ║ users MFA     ║  ║ manages own  ║
║  + PKCE      ║   ║  + PKCE      ║  ║ (admin only)  ║  ║ MFA methods  ║
╚══════════════╝   ╚══════════════╝  ╚═══════════════╝  ╚══════════════╝
       └─────────────────┘
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
| Demo apps | Node.js | 18+ | SSO demo + custom admin and self-service portals |
| Frontend | Alpine.js + Tailwind | — | Lightweight reactive UI without build process |
| Scripts | Python | 3.10+ | Token analysis and automation |
| Protocol (auth) | OAuth2 + OIDC | — | Modern authentication and authorization |
| Protocol (legacy) | SAML 2.0 | — | Enterprise legacy system integration |
| Token algorithm | RS256 | — | Asymmetric JWT signing |
| MFA standards | TOTP, WebAuthn FIDO2 | — | Strong second factors |

---

## Cryptography Foundation

### Why asymmetric cryptography (RS256)?

```
SYMMETRIC (HS256):
  One secret key for both signing and verifying.
  Any service that verifies can also forge tokens.

ASYMMETRIC (RS256):                      ← what this lab uses
  Private key signs (only Keycloak has it).
  Public key verifies (published at JWKS endpoint).
  Cannot forge without private key.
```

### How WebAuthn extends this to login itself

WebAuthn applies the same pattern to authentication:

```
REGISTRATION:
  Device generates key pair on secure hardware (TPM, Secure Enclave)
  Private key NEVER leaves the device
  Public key sent to Keycloak

LOGIN:
  Keycloak sends random challenge + origin
  Device signs challenge with private key (user unlocks: biometric/PIN)
  Keycloak verifies with stored public key

PHISHING IMMUNITY:
  Browser includes current origin in challenge
  Authenticator refuses to sign for wrong origin
  No code to relay, no way to bypass
```

---

## OAuth2 / OIDC Flows

### Authorization Code Flow + PKCE

```
  Browser              App Server              Keycloak
       │                    │                      │
       │── GET /dashboard ──►│                     │
       │◄── redirect to KC ─┤                      │
       │                                           │
       │── GET /auth?code_challenge=... ─────────►│
       │◄─────────────── Login + MFA ─────────────│
       │── POST credentials ──────────────────►│
       │◄────────── redirect /callback?code=ABC ──│
       │                                           │
       │── GET /callback?code=ABC ──►│             │
       │                    │── POST /token ─────►│
       │                    │◄── tokens ──────────│
       │◄── Session set ────┤                      │
```

### The three OIDC tokens

```
ACCESS TOKEN:    APIs use it to authorize calls (Authorization: Bearer)
ID TOKEN:        Application uses it to identify the user
REFRESH TOKEN:   Application uses it to renew expired access tokens silently
```

### The JWT logout gap

```
  t=0s    User logs in → access_token issued (TTL: 300s)
  t=10s   User logs out → Keycloak session invalidated
  t=30s   Attacker uses stolen access_token
  t=30s   API validates JWT locally → still valid → ACCEPTED ⚠️
  t=300s  Token finally expires
```

Mitigations: short TTL (300s), introspection on critical operations, backchannel logout for regulatory compliance.

---

## What This Lab Covers

### Module 1 — Enterprise Realm Setup
Keycloak with PostgreSQL, complete realm configuration, 4 client types correctly configured, roles, groups, test users with business attributes.

### Module 2 — LDAP / Active Directory Federation
Keycloak federated with OpenLDAP simulating corporate AD, group mappers, attribute mappers (`departmentNumber`, `employeeNumber` → JWT claims), users organized in OUs by department.

### Module 3 — MFA Authentication Flows
Custom Authentication Flow with method selector pattern, TOTP policy (HmacSHA1, 6 digits, 30-second window), `CONFIGURE_TOTP` required action for automatic onboarding of new users, flow binding via Keycloak 23 contextual menu.

### Module 4 — Enterprise MFA Complete (universal enforcement)
- WebAuthn (passkeys, security keys, biometrics) — FIDO2 compliant
- Recovery codes (preview feature enabled via flag)
- Multi-method selector in login (user picks WebAuthn / TOTP / Recovery)
- Universal MFA enforcement — every user authenticates with two factors
- Custom admin panel (port 3003) — authenticated, role-based, centralized governance
- Custom self-service portal (port 3004) — user manages own credentials
- Native Account REST API integration with `kc_action` redirects

### Module 5 — OAuth2 / OIDC Deep Dive
Authorization Code Flow + PKCE, Client Credentials grant, Refresh Token rotation, JWT anatomy and validation, logout gap demonstration.

### Module 6 — SSO Multi-Application
2 Node.js apps with real SSO, single login both apps accessible, global logout via `end_session_endpoint`, session ID verification across apps.

### Module 7 — Cryptography Applied
Live JWKS endpoint inspection, JWT forgery attempt, RS256 vs HS256 architectural implications, token signature verification.

### Module 8 — Security Hardening
Password policy, brute force protection, session lifetime management, HTTP security headers, ISO 27001 and ENS mapping.

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

cp .env.example .env
docker compose up -d

# Wait ~60-90s for Keycloak to initialize and auto-import the realm
curl -s http://localhost:8080/health/ready | python3 -m json.tool
```

The realm is **imported automatically** on first start from `realms/acmecorp-realm.json` (configured in `docker-compose.yml` via the `--import-realm` flag and a volume mount). No manual realm creation step is required.

### Load LDAP and configure federation

```bash
bash scripts/02_load_ldap.sh
bash scripts/03_setup_ldap_federation.sh
```

### Start the demo apps

```bash
# Install dependencies
for app in app1 app2 admin-panel self-service; do
  (cd apps/$app && npm install)
done

# Start them in the background
(cd apps/app1 && node server.js &)
(cd apps/app2 && node server.js &)
(cd apps/admin-panel && node server.js &)
(cd apps/self-service && node server.js &)
```

### Access the services

| Service | URL | Who |
|---------|-----|-----|
| **Keycloak Admin Console** | http://localhost:8080/admin | admin / Admin1234! |
| **Account Console (native)** | http://localhost:8080/realms/acmecorp/account | any user |
| **Portal App (SSO demo)** | http://localhost:3001 | any test user |
| **Finance App (SSO demo)** | http://localhost:3002 | SSO — no login needed after first |
| **Admin Panel** | http://localhost:3003 | admin role required |
| **Self-Service Portal** | http://localhost:3004 | any authenticated user |
| **phpLDAPadmin** | http://localhost:8090 | cn=admin,dc=acmecorp,dc=local |
| **MailHog** | http://localhost:8025 | — |

### First login — MFA setup walkthrough

The realm ships with no 2FA configured for any user. On first login each user will be prompted to set up TOTP via the `CONFIGURE_TOTP` required action. After that, they can add WebAuthn or Recovery Codes from the self-service portal.

```
1. Open http://localhost:3001 → log in as jdoe / Test1234!
2. Keycloak prompts you to configure TOTP (QR code)
   → scan with Google Authenticator / FreeOTP / Authy / Microsoft Authenticator
3. Enter the 6-digit code
4. You're logged in
5. Go to http://localhost:3004 to add a passkey (Touch ID, security key)
   or generate Recovery Codes
```

---

## Test Users

The lab ships with five test users. None of them has any 2FA pre-configured — the lab is shipped clean so anyone who clones it walks through the configuration as part of the learning experience.

| Username | Password | Roles | Federation |
|----------|----------|-------|------------|
| `itadmin` | Admin1234! | admin | local |
| `jdoe` | Test1234! | user, it-admin | local |
| `msmith` | Test1234! | user, finance-viewer | local |
| `ldap.jdoe` | Test1234! | via LDAP groups | OpenLDAP |
| `ldap.msmith` | Test1234! | via LDAP groups | OpenLDAP |

All users will be prompted to configure TOTP on their first login via the `CONFIGURE_TOTP` required action.

---

## Repository Structure

```
keycloak-iam-lab/
├── docker-compose.yml
├── .env.example
├── README.md
├── LICENSE
│
├── realms/
│   └── acmecorp-realm.json         # Realm imported automatically on first start
│
├── apps/
│   ├── app1/                       # SSO demo (port 3001)
│   ├── app2/                       # SSO demo (port 3002)
│   ├── admin-panel/                # Custom credential management (3003)
│   └── self-service/               # Custom user portal (3004)
│
├── ldap/bootstrap/                 # LDIF files for OpenLDAP
│
├── scripts/
│   ├── 02_load_ldap.sh
│   ├── 03_setup_ldap_federation.sh
│   ├── decode_token.py
│   ├── demo_logout_gap.py
│   ├── get_token.py
│   ├── verify_ldap.py
│   └── exercises/
│
└── docs/
    ├── macos-arm-setup.md
    └── troubleshooting.md
```

---

## Architecture Decisions

**Why PostgreSQL instead of H2?**

H2 is volatile and behaves differently from production databases. Using PostgreSQL from day one means identical behavior across all environments.

**Why RS256 instead of HS256?**

HS256 uses a symmetric key — any service that verifies tokens can also forge them. RS256 uses asymmetric keys: only Keycloak can sign, anyone can verify.

**Why WebAuthn as the primary MFA method?**

WebAuthn is phishing-resistant by design through origin binding. NIST SP 800-63B classifies it as AAL3, the highest assurance level. TOTP is AAL2 — vulnerable to real-time proxy MITM attacks.

**Why universal MFA instead of role-based MFA?**

ENS and ISO 27001 explicitly require strong authentication for all users with access to corporate resources. Applying MFA only to administrators leaves regular accounts as low-effort entry points for lateral movement, credential theft, and session hijacking. The right model is: every user authenticates with two factors, while RBAC and ABAC handle what they can do after that.

**Why a custom admin panel if Keycloak has one?**

The native Keycloak admin console is comprehensive but generic. A custom panel can focus the workflow on what security operations actually do daily, can match the corporate brand, and demonstrates the actual development skill needed to integrate Keycloak into a custom IAM stack.

**Why a self-service portal if Keycloak has the Account Console?**

The portal demonstrates how to embed credential management into a corporate application rather than redirecting users to the Keycloak Account Console. This is the pattern real consulting projects implement — corporate-branded UX with native Keycloak ceremonies behind the scenes via `kc_action`.

**Why two OAuth2 flows in the admin panel?**

Authorization Code Flow authenticates the human admin (accountability, role-based access). Client Credentials Flow authenticates the panel itself for API calls (separates user identity from service permissions). This is the standard pattern in any enterprise admin console.

**Why ship the realm as a JSON export?**

It guarantees a reproducible starting point. Anyone cloning the repo gets an identical Keycloak configuration on first boot: same clients, same roles, same flows, same LDAP federation settings. Manual setup scripts are error-prone and version-sensitive; a JSON export is deterministic.

---

## Standards Coverage

| Control | Standard | Implementation |
|---------|----------|---------------|
| Access Control | ISO 27001 A.9.4 | Password policy, brute force, session limits |
| Multi-factor Authentication | ISO 27001 A.9.4.2 | TOTP, WebAuthn, Recovery Codes — universal |
| Strong Authentication | NIST SP 800-63B AAL3 | WebAuthn available to all users |
| Session Management | ISO 27001 A.9.4.2 | Idle timeout, max lifespan |
| Audit Logging | ISO 27001 A.12.4 | Event logging, SIEM-ready format |
| Secure Transmission | ISO 27001 A.13.2 | TLS enforcement via `sslRequired` |
| Authentication Strength | ENS mp.access.3 | Universal MFA for all users |
| Attempt Limiting | ENS mp.access.5 | Brute force protection |
| Credential Management | ENS mp.access.1 | Centralized via Keycloak + self-service |
| HTTP Security | OWASP ASVS 2.1 | CSP, HSTS, X-Frame-Options headers |

---

## Known Issues and Solutions

See [docs/troubleshooting.md](docs/troubleshooting.md) for detailed solutions to:

- OpenLDAP exits immediately on macOS ARM with Docker Desktop
- `kcadm.sh set-password --temporary false` fails on Keycloak 23
- Client not allowed for direct access grants
- `realm_access.roles` not present in id_token (only in access_token)
- Recovery Codes not visible until preview feature enabled
- Email OTP not available natively (requires SPI extension)
- Container name conflicts when restarting the stack
- ACR-LoA mapping limitations in Keycloak 23 (step-up authentication)

---

## Future Work

The lab is structured for incremental growth. Open items that would extend it:

- **Step-up authentication with `acr_values`** — the patterns are documented in `docs/troubleshooting.md`, but full implementation in Keycloak 23 hits a known limitation with LoA mapping. Reliable implementation requires Keycloak 24+ or a custom Java SPI.
- **Identity Brokering** — Google, Microsoft (Azure AD), GitHub as external IdPs.
- **SAML 2.0 integration** — adding a legacy SAML app and demonstrating dual-protocol federation.
- **Email OTP** — implementing it as a custom authenticator SPI (Java).
- **Audit log export** — SIEM-ready JSON pipeline via the events listener API.

---

## References

- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [OAuth 2.0 — RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [OAuth 2.1 — Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [PKCE — RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [JWT — RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)
- [TOTP — RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238)
- [WebAuthn — W3C](https://www.w3.org/TR/webauthn-2/)
- [FIDO Alliance](https://fidoalliance.org/)
- [NIST SP 800-63B — Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [ENS — Real Decreto 311/2022](https://www.boe.es/eli/es/rd/2022/05/03/311)

---

## License

MIT — use it, modify it, share it.

---

<div align="center">

Built as part of a hands-on IAM training program for enterprise security consulting.
*Every problem in the troubleshooting guide happened in real life.*

</div>
