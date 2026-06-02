#!/usr/bin/env python3
"""
El gap de logout en JWT — demostración completa y rápida.
Ejecuta en menos de 30 segundos para ver todo antes de que expire el token.
"""
import requests
import time

KC = "http://localhost:8080"
REALM = "acmecorp"
BASE = f"{KC}/realms/{REALM}/protocol/openid-connect"

def step(n, title):
    print(f"\n{'─'*50}")
    print(f"  PASO {n}: {title}")
    print('─'*50)

# PASO 1: Obtener token
step(1, "Obtener token")
r = requests.post(f"{BASE}/token", data={
    'grant_type': 'password',
    'client_id': 'acmecorp-portal',
    'client_secret': 'portal-secret-local',
    'username': 'jdoe', 'password': 'Test1234!'
})
d = r.json()
token = d['access_token']
print(f"  Token obtenido — expira en {d['expires_in']}s")
print(f"  Token: {token[:30]}...")

# PASO 2: Verificar que funciona
step(2, "Usar token — ANTES del logout")
r = requests.get(f"{BASE}/userinfo", headers={'Authorization': f'Bearer {token}'})
if r.status_code == 200:
    print(f"  ✅ UserInfo: {r.json().get('preferred_username')} — token válido")
else:
    print(f"  ❌ Error: {r.status_code}")

# PASO 3: Logout
step(3, "Cerrar sesión en Keycloak")
r = requests.post(f"{BASE}/logout",
    headers={'Authorization': f'Bearer {token}'},
    data={'client_id': 'acmecorp-portal', 'client_secret': 'portal-secret-local'})
print(f"  Logout HTTP: {r.status_code} — sesión cerrada en Keycloak")

# PASO 4: Reusar token inmediatamente
step(4, "Reusar token — DESPUÉS del logout (inmediato)")
r = requests.get(f"{BASE}/userinfo", headers={'Authorization': f'Bearer {token}'})
print(f"  UserInfo status: {r.status_code}")
if r.status_code == 200:
    print(f"  ⚠️  SIGUE FUNCIONANDO: {r.json().get('preferred_username')}")
    print(f"  ← El JWT es válido hasta exp aunque la sesión esté cerrada")
else:
    print(f"  ✅ Rechazado (token expirado)")

# PASO 5: Introspección — qué dice Keycloak
step(5, "Introspección — el estado REAL según Keycloak")
r = requests.post(f"{BASE}/token/introspect",
    data={'client_id': 'acmecorp-portal',
          'client_secret': 'portal-secret-local',
          'token': token})
active = r.json().get('active')
print(f"  active: {active}")
if not active:
    print(f"  ✅ Keycloak sabe que la sesión terminó")
    print(f"  ← Pero si la API valida JWT localmente, no lo sabe")

# CONCLUSIÓN
print(f"\n{'═'*50}")
print("  CONCLUSIÓN")
print('═'*50)
print("""
  MÉTODO           | Tras logout | Latencia    | Uso
  ─────────────────────────────────────────────────
  JWT local        | Válido ⚠️   | 0ms ✅      | APIs normales
  UserInfo         | Válido ⚠️   | ~10ms       | Info usuario
  Introspection    | Inválido ✅ | ~10ms       | APIs críticas
  ─────────────────────────────────────────────────

  Estrategia enterprise:
    TTL 300s + introspection en endpoints sensibles
    Backchannel logout para garantía total
""")
