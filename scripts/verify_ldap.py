#!/usr/bin/env python3
"""
verify_ldap.py — Verifica que la federación LDAP funciona correctamente.
Comprueba: login, atributos en token, grupos.
"""
import requests
import base64
import json

KC = "http://localhost:8080"
REALM = "acmecorp"

def decode_jwt(token):
    p = token.split('.')[1]
    p += '=' * (4 - len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p))

def verify_user(username, password, expected):
    r = requests.post(
        f"{KC}/realms/{REALM}/protocol/openid-connect/token",
        data={
            'grant_type': 'password',
            'client_id': 'acmecorp-portal',
            'client_secret': 'portal-secret-local',
            'username': username,
            'password': password
        }
    )

    sep = "─" * 45
    print(f"\n{sep}")
    print(f"  Usuario: {username}")
    print(sep)

    if 'access_token' not in r.json():
        print(f"  ❌ Login fallido: {r.json().get('error_description')}")
        return

    claims = decode_jwt(r.json()['access_token'])
    print(f"  ✅ Login OK")

    checks = [
        ('preferred_username', expected.get('username')),
        ('department',         expected.get('department')),
        ('employee_id',        expected.get('employee_id')),
    ]

    for claim, expected_val in checks:
        actual = claims.get(claim, '(vacío)')
        status = "✅" if str(actual) == str(expected_val) else "❌"
        print(f"  {status} {claim}: {actual}")
        if str(actual) != str(expected_val):
            print(f"      esperado: {expected_val}")

    groups = claims.get('groups', [])
    print(f"  {'✅' if groups else '⚠️ '} groups: {groups}")

if __name__ == "__main__":
    print("\n" + "═" * 45)
    print("  LDAP FEDERATION VERIFICATION")
    print("═" * 45)

    verify_user("ldap.jdoe", "Test1234!", {
        'username':    'ldap.jdoe',
        'department':  'IT',
        'employee_id': 'EMP-L001'
    })

    verify_user("ldap.msmith", "Test1234!", {
        'username':    'ldap.msmith',
        'department':  'Finance',
        'employee_id': 'EMP-L002'
    })

    print("\n" + "═" * 45)
    print("  Si ves ✅ en todos los campos, LDAP federation")
    print("  está completamente operativa.")
    print("═" * 45)
