#!/bin/bash
# =============================================================================
# 03_setup_ldap_federation.sh — Federate Keycloak with OpenLDAP
# =============================================================================

set -e

KC_URL="http://localhost:8080"
REALM="acmecorp"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✅ $1${NC}"; }
info() { echo -e "${YELLOW}  ▶  $1${NC}"; }
err()  { echo -e "${RED}  ❌ $1${NC}"; exit 1; }

docker exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server $KC_URL --realm master \
  --user admin --password Admin1234!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LDAP FEDERATION SETUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── LDAP Federation ─────────────────────────────
info "Creating LDAP User Federation..."

LDAP_ID=$(docker exec keycloak /opt/keycloak/bin/kcadm.sh create components \
  -r $REALM \
  -s name="acmecorp-ldap" \
  -s providerId=ldap \
  -s providerType=org.keycloak.storage.UserStorageProvider \
  -s 'config.priority=["0"]' \
  -s 'config.enabled=["true"]' \
  -s 'config.editMode=["READ_ONLY"]' \
  -s 'config.syncRegistrations=["false"]' \
  -s 'config.vendor=["other"]' \
  -s 'config.usernameLDAPAttribute=["uid"]' \
  -s 'config.rdnLDAPAttribute=["uid"]' \
  -s 'config.uuidLDAPAttribute=["entryUUID"]' \
  -s 'config.userObjectClasses=["inetOrgPerson, posixAccount"]' \
  -s 'config.connectionUrl=["ldap://openldap:389"]' \
  -s 'config.usersDn=["ou=people,dc=acmecorp,dc=local"]' \
  -s 'config.authType=["simple"]' \
  -s 'config.bindDn=["cn=admin,dc=acmecorp,dc=local"]' \
  -s 'config.bindCredential=["LdapAdmin123!"]' \
  -s 'config.searchScope=["2"]' \
  -s 'config.connectionPooling=["true"]' \
  -s 'config.pagination=["true"]' \
  -s 'config.importEnabled=["true"]' \
  -s 'config.batchSizeForSync=["1000"]' \
  -s 'config.cachePolicy=["DEFAULT"]' \
  -i 2>&1 | tail -1)

ok "LDAP Federation created — ID: $LDAP_ID"

# ─── Group Mapper ─────────────────────────────────
info "Adding group mapper..."
docker exec keycloak /opt/keycloak/bin/kcadm.sh create components \
  -r $REALM \
  -s name="ldap-group-mapper" \
  -s providerId=group-ldap-mapper \
  -s providerType=org.keycloak.storage.ldap.mappers.LDAPStorageMapper \
  -s parentId=$LDAP_ID \
  -s 'config.mode=["READ_ONLY"]' \
  -s 'config.membership.attribute.type=["DN"]' \
  -s 'config.membership.ldap.attribute=["member"]' \
  -s 'config.groups.dn=["ou=groups,dc=acmecorp,dc=local"]' \
  -s 'config.group.name.ldap.attribute=["cn"]' \
  -s 'config.group.object.classes=["groupOfNames"]' \
  -s 'config.preserve.group.inheritance=["true"]' \
  -s 'config.user.roles.retrieve.strategy=["LOAD_GROUPS_BY_MEMBER_ATTRIBUTE"]'
ok "Group mapper (LDAP groups → Keycloak groups)"

# ─── Attribute Mapper: department ────────────────
info "Adding department attribute mapper..."
docker exec keycloak /opt/keycloak/bin/kcadm.sh create components \
  -r $REALM \
  -s name="department-mapper" \
  -s providerId=user-attribute-ldap-mapper \
  -s providerType=org.keycloak.storage.ldap.mappers.LDAPStorageMapper \
  -s parentId=$LDAP_ID \
  -s 'config.ldap.attribute=["departmentNumber"]' \
  -s 'config.read.only=["true"]' \
  -s 'config.always.read.value.from.ldap=["true"]' \
  -s 'config.user.model.attribute=["department"]' \
  -s 'config.is.mandatory.in.ldap=["false"]'
ok "Department mapper (departmentNumber → department)"

# ─── Attribute Mapper: employeeNumber ────────────
info "Adding employeeNumber attribute mapper..."
docker exec keycloak /opt/keycloak/bin/kcadm.sh create components \
  -r $REALM \
  -s name="employeeNumber-mapper" \
  -s providerId=user-attribute-ldap-mapper \
  -s providerType=org.keycloak.storage.ldap.mappers.LDAPStorageMapper \
  -s parentId=$LDAP_ID \
  -s 'config.ldap.attribute=["employeeNumber"]' \
  -s 'config.read.only=["true"]' \
  -s 'config.always.read.value.from.ldap=["true"]' \
  -s 'config.user.model.attribute=["employeeNumber"]' \
  -s 'config.is.mandatory.in.ldap=["false"]'
ok "EmployeeNumber mapper (employeeNumber → employeeNumber)"

# ─── Sync ────────────────────────────────────────
info "Syncing users from LDAP..."
docker exec keycloak /opt/keycloak/bin/kcadm.sh create \
  "user-storage/${LDAP_ID}/sync?action=triggerFullSync" \
  -r $REALM 2>/dev/null || true
ok "Sync completed"

# ─── Protocol Mappers ────────────────────────────
info "Adding protocol mappers to acmecorp-portal..."

CLIENT_UUID=$(docker exec keycloak /opt/keycloak/bin/kcadm.sh get clients \
  -r $REALM --fields id,clientId \
  | python3 -c "
import json,sys
for c in json.load(sys.stdin):
    if c['clientId']=='acmecorp-portal': print(c['id'])
")

# department → JWT claim
docker exec keycloak /opt/keycloak/bin/kcadm.sh create \
  clients/$CLIENT_UUID/protocol-mappers/models \
  -r $REALM \
  -s name="department-claim" \
  -s protocol=openid-connect \
  -s protocolMapper=oidc-user-attribute-mapper \
  -s consentRequired=false \
  -s 'config.user.attribute=["department"]' \
  -s 'config.claim.name=["department"]' \
  -s 'config.jsonType.label=["String"]' \
  -s 'config.id.token.claim=["true"]' \
  -s 'config.access.token.claim=["true"]' \
  -s 'config.userinfo.token.claim=["true"]' 2>/dev/null || true
ok "Protocol mapper: department → JWT"

# employeeNumber → JWT claim
docker exec keycloak /opt/keycloak/bin/kcadm.sh create \
  clients/$CLIENT_UUID/protocol-mappers/models \
  -r $REALM \
  -s name="employeeNumber-claim" \
  -s protocol=openid-connect \
  -s protocolMapper=oidc-user-attribute-mapper \
  -s consentRequired=false \
  -s 'config.user.attribute=["employeeNumber"]' \
  -s 'config.claim.name=["employee_id"]' \
  -s 'config.jsonType.label=["String"]' \
  -s 'config.id.token.claim=["true"]' \
  -s 'config.access.token.claim=["true"]' \
  -s 'config.userinfo.token.claim=["true"]' 2>/dev/null || true
ok "Protocol mapper: employeeNumber → employee_id JWT"

# groups → JWT claim
docker exec keycloak /opt/keycloak/bin/kcadm.sh create \
  clients/$CLIENT_UUID/protocol-mappers/models \
  -r $REALM \
  -s name="groups-claim" \
  -s protocol=openid-connect \
  -s protocolMapper=oidc-group-membership-mapper \
  -s consentRequired=false \
  -s 'config.full.path=["false"]' \
  -s 'config.id.token.claim=["true"]' \
  -s 'config.access.token.claim=["true"]' \
  -s 'config.claim.name=["groups"]' \
  -s 'config.userinfo.token.claim=["true"]' 2>/dev/null || true
ok "Protocol mapper: groups → JWT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "LDAP Federation fully configured"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Verify with:"
echo "  python3 scripts/verify_ldap.py"
