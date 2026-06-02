#!/usr/bin/env python3
"""
Comparativa de todos los grant types.
Observa las diferencias en los tokens resultantes.
"""
import requests
import json
import base64

KC = "http://localhost:8080"
REALM = "acmecorp"
TOKEN_URL = f"{KC}/realms/{REALM}/protocol/openid-connect/token"

def decode_payload(token):
    if not token or '.' not in token:
        return {}
    p = token.split('.')[1]
    p += '=' * (4 - len(p) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(p))
    except:
        return {}

def separator(title):
    print(f"\n{'━'*55}")
    print(f"  {title}")
    print('━'*55)

# ─── GRANT TYPE 1: Resource Owner Password ─────────────
separator("GRANT TYPE 1: password (ROPC) — solo para testing")
print("  ⚠️  Anti-patrón en producción — bypasea MFA")

r = requests.post(TOKEN_URL, data={
    'grant_type': 'password',
    'client_id': 'acmecorp-portal',
    'client_secret': 'portal-secret-local',
    'username': 'jdoe',
    'password': 'Test1234!'
})
d = r.json()
if 'access_token' in d:
    at = decode_payload(d['access_token'])
    print(f"  ✅ Token obtenido")
    print(f"  sub:      {at.get('sub')}")
    print(f"  username: {at.get('preferred_username')}  ← hay usuario humano")
    print(f"  roles:    {at.get('realm_access',{}).get('roles',[])}")
    print(f"  expires:  {d.get('expires_in')}s")
else:
    print(f"  ❌ Error: {d.get('error_description')}")

# ─── GRANT TYPE 2: Client Credentials ──────────────────
separator("GRANT TYPE 2: client_credentials — para servicios M2M")
print("  ✅ Patrón correcto para CRON jobs y microservicios")

r = requests.post(TOKEN_URL, data={
    'grant_type': 'client_credentials',
    'client_id': 'acmecorp-integration',
    'client_secret': 'integration-secret-local'
})
d = r.json()
if 'access_token' in d:
    at = decode_payload(d['access_token'])
    print(f"  ✅ Token obtenido")
    print(f"  sub:      {at.get('sub')}")
    print(f"  username: {at.get('preferred_username')}  ← service account, no humano")
    print(f"  ¿email?:  {at.get('email', '(no hay email — no es un humano)')}")
    print(f"  expires:  {d.get('expires_in')}s")
    print(f"  ¿refresh_token?: {'refresh_token' in d}  ← no hay refresh en CC")
else:
    print(f"  ❌ Error: {d}")

# ─── GRANT TYPE 3: Refresh Token ───────────────────────
separator("GRANT TYPE 3: refresh_token — renovar sin relogin")

# Primero obtener tokens iniciales
r1 = requests.post(TOKEN_URL, data={
    'grant_type': 'password',
    'client_id': 'acmecorp-portal',
    'client_secret': 'portal-secret-local',
    'username': 'jdoe',
    'password': 'Test1234!'
})
initial = r1.json()
print(f"  Token inicial obtenido")
print(f"  Access token (primeros 20): {initial['access_token'][:20]}...")

# Ahora renovar con refresh
r2 = requests.post(TOKEN_URL, data={
    'grant_type': 'refresh_token',
    'client_id': 'acmecorp-portal',
    'client_secret': 'portal-secret-local',
    'refresh_token': initial['refresh_token']
})
refreshed = r2.json()
if 'access_token' in refreshed:
    print(f"  ✅ Nuevo access token:      {refreshed['access_token'][:20]}...")
    print(f"  ¿Son iguales?: {initial['access_token'][:20] == refreshed['access_token'][:20]}")
    print(f"  ← Cada refresh genera un token NUEVO aunque el usuario sea el mismo")

    # Intentar usar el refresh_token anterior (ya está invalidado si hay rotación)
    r3 = requests.post(TOKEN_URL, data={
        'grant_type': 'refresh_token',
        'client_id': 'acmecorp-portal',
        'client_secret': 'portal-secret-local',
        'refresh_token': initial['refresh_token']
    })
    if r3.status_code != 200:
        print(f"  Reusar refresh_token anterior: ❌ inválido (rotación activa)")
    else:
        print(f"  Reusar refresh_token anterior: ✅ aceptado (sin rotación)")
else:
    print(f"  ❌ Error: {refreshed.get('error_description')}")

print("\n")
print("RESUMEN COMPARATIVO:")
print("─"*55)
print("  grant_type         | usuario | refresh | M2M")
print("─"*55)
print("  password (ROPC)    |   sí    |   sí    |  no — anti-patrón")
print("  client_credentials |   no    |   no    | sí — correcto")
print("  refresh_token      |   sí    |   sí    |  no — renovación")
print("  authorization_code |   sí    |   sí    | no — interactivo (browser)")
