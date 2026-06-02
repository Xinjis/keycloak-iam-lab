#!/bin/bash
# =============================================================================
# 02_load_ldap.sh — Loads LDIF bootstrap data into OpenLDAP
# =============================================================================

set -e

LDAP_ADMIN_DN="cn=admin,dc=acmecorp,dc=local"
LDAP_ADMIN_PASSWORD="${LDAP_ADMIN_PASSWORD:-LdapAdmin123!}"
BOOTSTRAP_DIR="$(dirname "$0")/../ldap/bootstrap"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✅ $1${NC}"; }
info() { echo -e "${YELLOW}  ▶  $1${NC}"; }
err()  { echo -e "${RED}  ❌ $1${NC}"; exit 1; }

if ! docker exec openldap ldapsearch \
    -x -H ldap://localhost \
    -D "$LDAP_ADMIN_DN" \
    -w "$LDAP_ADMIN_PASSWORD" \
    -b "dc=acmecorp,dc=local" "(objectClass=dcObject)" > /dev/null 2>&1; then
  err "OpenLDAP not running — run: docker compose up -d"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  KEYCLOAK IAM LAB — LDAP Data Load"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

info "Copying LDIF files to container..."
for ldif in "$BOOTSTRAP_DIR"/*.ldif; do
  filename=$(basename "$ldif")
  docker cp "$ldif" "openldap:/tmp/$filename"
  ok "Copied: $filename"
done

info "Loading structure..."
docker exec openldap ldapadd \
  -x -H ldap://localhost \
  -D "$LDAP_ADMIN_DN" \
  -w "$LDAP_ADMIN_PASSWORD" \
  -f /tmp/01-structure.ldif 2>&1 | grep -E "adding|already exists|error" || true
ok "Structure loaded"

info "Loading users..."
docker exec openldap ldapadd \
  -x -H ldap://localhost \
  -D "$LDAP_ADMIN_DN" \
  -w "$LDAP_ADMIN_PASSWORD" \
  -f /tmp/02-users.ldif 2>&1 | grep -E "adding|already exists|error" || true
ok "Users loaded"

info "Loading groups..."
docker exec openldap ldapadd \
  -x -H ldap://localhost \
  -D "$LDAP_ADMIN_DN" \
  -w "$LDAP_ADMIN_PASSWORD" \
  -f /tmp/03-groups.ldif 2>&1 | grep -E "adding|already exists|error" || true
ok "Groups loaded"

echo ""
info "Verifying..."
docker exec openldap ldapsearch \
  -x -H ldap://localhost \
  -D "$LDAP_ADMIN_DN" \
  -w "$LDAP_ADMIN_PASSWORD" \
  -b "ou=people,dc=acmecorp,dc=local" \
  "(objectClass=inetOrgPerson)" uid departmentNumber 2>/dev/null \
  | grep -E "uid:|departmentNumber:" | while read -r line; do
    echo "    $line"
  done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "LDAP data loaded"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  phpLDAPadmin: http://localhost:8090"
echo "  Next: bash scripts/03_setup_ldap_federation.sh"
