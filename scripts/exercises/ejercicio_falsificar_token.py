import base64
import json
import requests

KC = "http://localhost:8080"
REALM = "acmecorp"

# Obtener token real
r = requests.post(f"{KC}/realms/{REALM}/protocol/openid-connect/token",
    data={
        'grant_type': 'password',
        'client_id': 'acmecorp-portal',
        'client_secret': 'portal-secret-local',
        'username': 'jdoe',
        'password': 'Test1234!'
    })
token = r.json()['access_token']

# Decodificar el payload
parts = token.split('.')
payload_b64 = parts[1] + '=' * (4 - len(parts[1]) % 4)
payload = json.loads(base64.urlsafe_b64decode(payload_b64))

print("=== PAYLOAD ORIGINAL ===")
print(f"  usuario: {payload['preferred_username']}")
print(f"  roles:   {payload['realm_access']['roles']}")

# INTENTAR MODIFICAR: cambiar rol 'user' a 'admin'
payload['realm_access']['roles'].append('FAKE-SUPER-ADMIN')
payload['preferred_username'] = 'HACKER'

# Re-encodear el payload modificado
fake_payload = base64.urlsafe_b64encode(
    json.dumps(payload).encode()
).rstrip(b'=').decode()

# Construir token falsificado (mismo header y firma, payload modificado)
fake_token = f"{parts[0]}.{fake_payload}.{parts[2]}"

print("\n=== TOKEN FALSIFICADO — intentando usarlo ===")

# Intentar usar el token falsificado en el userinfo endpoint
r2 = requests.get(
    f"{KC}/realms/{REALM}/protocol/openid-connect/userinfo",
    headers={'Authorization': f'Bearer {fake_token}'}
)

print(f"  HTTP Status: {r2.status_code}")
if r2.status_code == 200:
    print("  ⚠️  ACEPTADO (no debería pasar)")
else:
    print("  ✅ RECHAZADO — la firma no coincide con el payload modificado")
    print(f"  Respuesta: {r2.text}")

print("\n=== TOKEN ORIGINAL — sigue funcionando ===")
r3 = requests.get(
    f"{KC}/realms/{REALM}/protocol/openid-connect/userinfo",
    headers={'Authorization': f'Bearer {token}'}
)
print(f"  HTTP Status: {r3.status_code}")
if r3.status_code == 200:
    print(f"  ✅ Aceptado — usuario: {r3.json().get('preferred_username')}")
