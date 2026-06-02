# Troubleshooting

Real issues encountered while building this lab, with solutions.
Documented so you don't spend time debugging what has already been solved.

---

## OpenLDAP exits immediately on macOS ARM

**Symptom:**
```
openldap exited with code 1
rm: cannot remove '/container/service/slapd/assets/config/bootstrap/ldif/custom': Device or resource busy
ERROR: /container/run/startup/slapd failed with status 1
```

**Cause:** The `osixia/openldap` image deletes its bootstrap LDIF directory
after init. Docker Desktop on macOS prevents containers from deleting
bind-mounted directories.

**Fix:** The `docker-compose.yml` does not bind-mount the bootstrap directory.
Load LDIFs manually after the container starts:

```bash
bash scripts/02_load_ldap.sh
```

**Platform note:** This issue only affects macOS Docker Desktop.
On Linux, bind-mounting works correctly.

---

## kcadm.sh set-password --temporary false fails

**Symptom:**
```
Invalid option: false
Try 'kcadm.sh help set-password' for more information
```

**Cause:** Keycloak 23 removed the `--temporary` flag from `set-password`.
Non-temporary is now the default behavior.

**Fix:**
```bash
# ❌ Keycloak 23 — flag removed
kcadm.sh set-password --new-password MyPass --temporary false

# ✅ Correct for Keycloak 23+
kcadm.sh set-password --new-password MyPass
```

---

## Client not allowed for direct access grants

**Symptom:**
```json
{
  "error": "unauthorized_client",
  "error_description": "Client not allowed for direct access grants"
}
```

**Cause:** `directAccessGrantsEnabled=false` on the client.
This is the correct production setting — the Resource Owner Password
Credentials (ROPC) grant type is disabled by default.

**Why it's disabled by default:**
- The client receives the user's credentials directly (bypasses MFA)
- Exposes passwords to the client application
- Deprecated in OAuth 2.1

**Fix for lab/testing only:**
```bash
docker exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master \
  --user admin --password Admin1234!

CLIENT_UUID=$(docker exec keycloak /opt/keycloak/bin/kcadm.sh get clients \
  -r acmecorp --fields id,clientId \
  | python3 -c "
import json,sys
for c in json.load(sys.stdin):
    if c['clientId']=='acmecorp-portal': print(c['id'])
")

docker exec keycloak /opt/keycloak/bin/kcadm.sh update \
  clients/$CLIENT_UUID -r acmecorp \
  -s directAccessGrantsEnabled=true
```

> ⚠️ **Never enable ROPC in production.**

---

## Keycloak Admin Console login fails with user_not_found

**Symptom:** Trying to log into `http://localhost:8080/admin` with `jdoe`.
```
error="user_not_found", username="jdoe"
```

**Cause:** The Admin Console authenticates against the `master` realm.
`jdoe` exists only in the `acmecorp` realm — these are completely separate
user directories.

**Fix:** Use the correct URL for each user type:

| URL | Who can log in |
|-----|---------------|
| `http://localhost:8080/admin` | `admin` (master realm) |
| `http://localhost:8080/realms/acmecorp/account` | `jdoe`, `msmith`, `itadmin` |

---

## Container name conflicts when restarting

**Symptom:**
```
Error response from daemon: Conflict. The container name "/keycloak" 
is already in use by container "abc123..."
```

**Cause:** A container from a previous run is still registered in Docker,
even if it is stopped. This happens when `docker compose down` was not
run cleanly, or when multiple compose projects use the same container names.

**Fix:**
```bash
# Stop and remove all containers from this project
docker compose down

# If containers from other projects are conflicting, remove them by name
docker rm -f keycloak kc-postgres openldap phpldapadmin mailhog 2>/dev/null || true

# Clean up any stopped containers
docker container prune -f

# Start fresh
docker compose up -d
```

---

## Keycloak takes too long to start / health check fails

**Cause:** Insufficient memory allocated to Docker.

**Fix:** Set Docker memory to at least 6GB.
- **Docker Desktop:** Settings → Resources → Memory → 6GB → Apply & Restart
- **Linux:** Add `--memory=2g` to the Keycloak service if using resource limits

Keycloak 23 needs ~1GB RAM. The full stack uses ~2.5GB.

---

## python3 scripts fail with ModuleNotFoundError

**Symptom:**
```
ModuleNotFoundError: No module named 'requests'
```

**Fix:**
```bash
pip3 install requests --break-system-packages
```

---

## Node.js apps fail with Cannot read properties of undefined (reading 'discover')

**Symptom:**
```
TypeError: Cannot read properties of undefined (reading 'discover')
```

**Cause:** `openid-client` v6 changed its API completely. The apps use v5 syntax.

**Fix:**
```bash
cd apps/portal
npm install openid-client@5.6.4

cd ../finance
npm install openid-client@5.6.4
```
