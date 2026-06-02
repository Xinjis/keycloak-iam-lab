#!/bin/bash
KC_URL="http://localhost:8080"
REALM="acmecorp"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AUTENTICANDO EN KEYCLOAK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

docker exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server $KC_URL --realm master \
  --user admin --password Admin1234!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CREANDO REALM: $REALM"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

docker exec keycloak /opt/keycloak/bin/kcadm.sh create realms \
  -s realm=$REALM \
  -s enabled=true \
  -s displayName="AcmeCorp Enterprise" \
  -s loginWithEmailAllowed=true \
  -s resetPasswordAllowed=true \
  -s bruteForceProtected=true \
  -s failureFactor=5 \
  -s maxFailureWaitSeconds=900 \
  -s accessTokenLifespan=300 \
  -s ssoSessionIdleTimeout=1800 \
  -s ssoSessionMaxLifespan=36000

echo "✅ Realm $REALM creado"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CREANDO CLIENTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

docker exec keycloak /opt/keycloak/bin/kcadm.sh create clients -r $REALM \
  -s clientId=acmecorp-portal \
  -s name="Portal Web" \
  -s enabled=true \
  -s publicClient=false \
  -s secret=portal-secret-local \
  -s 'redirectUris=["http://localhost:3000/*","http://localhost:3001/*"]' \
  -s 'webOrigins=["http://localhost:3000","http://localhost:3001"]' \
  -s standardFlowEnabled=true \
  -s directAccessGrantsEnabled=false \
  -s serviceAccountsEnabled=false \
  -s protocol=openid-connect
echo "  ✅ acmecorp-portal (web app confidential)"

docker exec keycloak /opt/keycloak/bin/kcadm.sh create clients -r $REALM \
  -s clientId=acmecorp-api \
  -s name="Backend API" \
  -s enabled=true \
  -s bearerOnly=true \
  -s protocol=openid-connect
echo "  ✅ acmecorp-api (bearer-only)"

docker exec keycloak /opt/keycloak/bin/kcadm.sh create clients -r $REALM \
  -s clientId=acmecorp-integration \
  -s name="Integration Service" \
  -s enabled=true \
  -s publicClient=false \
  -s secret=integration-secret-local \
  -s standardFlowEnabled=false \
  -s serviceAccountsEnabled=true \
  -s protocol=openid-connect
echo "  ✅ acmecorp-integration (service account)"

docker exec keycloak /opt/keycloak/bin/kcadm.sh create clients -r $REALM \
  -s clientId=acmecorp-mobile \
  -s name="Mobile App" \
  -s enabled=true \
  -s publicClient=true \
  -s 'redirectUris=["acmecorp://callback","http://localhost:3002/*"]' \
  -s standardFlowEnabled=true \
  -s directAccessGrantsEnabled=false \
  -s protocol=openid-connect
echo "  ✅ acmecorp-mobile (public + PKCE)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CREANDO ROLES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for role in "user" "manager" "admin" "finance-viewer" "finance-approver" "it-admin"; do
  docker exec keycloak /opt/keycloak/bin/kcadm.sh create roles \
    -r $REALM -s name=$role
  echo "  ✅ Rol: $role"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CREANDO USUARIOS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# jdoe — usuario IT con rol admin
docker exec keycloak /opt/keycloak/bin/kcadm.sh create users -r $REALM \
  -s username=jdoe \
  -s email=jdoe@acmecorp.local \
  -s firstName=John \
  -s lastName=Doe \
  -s enabled=true \
  -s emailVerified=true \
  -s 'attributes={"department":["IT"],"employeeNumber":["EMP-001"],"title":["Senior Developer"]}'

docker exec keycloak /opt/keycloak/bin/kcadm.sh set-password -r $REALM \
  --username jdoe --new-password Test1234! --temporary false

docker exec keycloak /opt/keycloak/bin/kcadm.sh add-roles -r $REALM \
  --uusername jdoe --rolename user
docker exec keycloak /opt/keycloak/bin/kcadm.sh add-roles -r $REALM \
  --uusername jdoe --rolename it-admin
echo "  ✅ jdoe (IT, roles: user + it-admin)"

# msmith — usuario Finance
docker exec keycloak /opt/keycloak/bin/kcadm.sh create users -r $REALM \
  -s username=msmith \
  -s email=msmith@acmecorp.local \
  -s firstName=Mary \
  -s lastName=Smith \
  -s enabled=true \
  -s emailVerified=true \
  -s 'attributes={"department":["Finance"],"employeeNumber":["EMP-002"],"title":["Financial Analyst"]}'

docker exec keycloak /opt/keycloak/bin/kcadm.sh set-password -r $REALM \
  --username msmith --new-password Test1234! --temporary false

docker exec keycloak /opt/keycloak/bin/kcadm.sh add-roles -r $REALM \
  --uusername msmith --rolename user
docker exec keycloak /opt/keycloak/bin/kcadm.sh add-roles -r $REALM \
  --uusername msmith --rolename finance-viewer
echo "  ✅ msmith (Finance, roles: user + finance-viewer)"

# itadmin — administrador
docker exec keycloak /opt/keycloak/bin/kcadm.sh create users -r $REALM \
  -s username=itadmin \
  -s email=itadmin@acmecorp.local \
  -s firstName=IT \
  -s lastName=Admin \
  -s enabled=true \
  -s emailVerified=true

docker exec keycloak /opt/keycloak/bin/kcadm.sh set-password -r $REALM \
  --username itadmin --new-password Admin1234! --temporary false

docker exec keycloak /opt/keycloak/bin/kcadm.sh add-roles -r $REALM \
  --uusername itadmin --rolename admin
echo "  ✅ itadmin (roles: admin)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ SETUP COMPLETO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Admin Console: http://localhost:8080/admin"
echo "  Realm acmecorp: http://localhost:8080/realms/acmecorp"
echo ""
echo "  Usuarios creados:"
echo "    jdoe     / Test1234!   (IT, user + it-admin)"
echo "    msmith   / Test1234!   (Finance, user + finance-viewer)"
echo "    itadmin  / Admin1234!  (admin)"
