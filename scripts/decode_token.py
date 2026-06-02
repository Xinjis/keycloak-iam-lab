#!/usr/bin/env python3
"""
decode_token.py — Decode and analyze a Keycloak JWT.

Usage:
  python3 scripts/decode_token.py                    # fetches a fresh token
  python3 scripts/decode_token.py --token <jwt>      # decode provided token
  python3 scripts/decode_token.py --verify           # verify signature via JWKS
"""
import argparse
import base64
import json
import requests
from datetime import datetime

KC_URL = "http://localhost:8080"
REALM  = "acmecorp"


def decode_part(b64url: str) -> dict:
    padded = b64url + "=" * (4 - len(b64url) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def get_fresh_token() -> str:
    r = requests.post(
        f"{KC_URL}/realms/{REALM}/protocol/openid-connect/token",
        data={
            "grant_type":    "password",
            "client_id":     "acmecorp-portal",
            "client_secret": "portal-secret-local",
            "username":      "jdoe",
            "password":      "Test1234!",
            "scope":         "openid email profile",
        },
    )
    d = r.json()
    if "access_token" not in d:
        raise SystemExit(f"Could not obtain token: {d.get('error_description', d)}")
    return d["access_token"]


def verify_signature(token: str) -> bool:
    """Verify JWT signature using Keycloak's public JWKS."""
    try:
        from jwt import decode as jwt_decode, get_unverified_header
        from jwt.algorithms import RSAAlgorithm

        header = get_unverified_header(token)
        kid = header.get("kid")

        jwks = requests.get(
            f"{KC_URL}/realms/{REALM}/protocol/openid-connect/certs"
        ).json()
        key_data = next(
            (k for k in jwks.get("keys", []) if k.get("kid") == kid), None
        )
        if not key_data:
            print("  ⚠️  Key not found in JWKS")
            return False

        pub_key = RSAAlgorithm.from_jwk(json.dumps(key_data))
        jwt_decode(token, pub_key, algorithms=["RS256"], options={"verify_aud": False})
        return True
    except ImportError:
        print("  ⚠️  PyJWT not installed — run: pip install pyjwt cryptography")
        return False
    except Exception as e:
        print(f"  ❌ Signature invalid: {e}")
        return False


def analyze(token: str, verify: bool = False) -> None:
    parts = token.split(".")
    if len(parts) != 3:
        raise SystemExit("Not a valid JWT (expected 3 parts separated by '.')")

    header  = decode_part(parts[0])
    payload = decode_part(parts[1])

    sep = "═" * 58

    # ── HEADER ──────────────────────────────────────────────
    print(f"\n{sep}")
    print("  JWT HEADER")
    print(sep)
    print(f"  alg: {header.get('alg')}  ← signing algorithm")
    print(f"  typ: {header.get('typ')}  ← token type")
    print(f"  kid: {header.get('kid')}  ← key ID (matches JWKS entry)")
    print()
    print("  The API reads 'kid' to find the right public key in JWKS:")
    print(f"  {KC_URL}/realms/{REALM}/protocol/openid-connect/certs")

    # ── TIMING ──────────────────────────────────────────────
    print(f"\n{sep}")
    print("  TIMING CLAIMS")
    print(sep)
    iat = payload.get("iat", 0)
    exp = payload.get("exp", 0)
    now = datetime.now().timestamp()

    print(f"  iat (issued at):  {datetime.fromtimestamp(iat)}")
    print(f"  exp (expires):    {datetime.fromtimestamp(exp)}")
    print(f"  ttl:              {exp - iat}s")

    if now > exp:
        remaining = int(now - exp)
        print(f"  status:          ❌ EXPIRED ({remaining}s ago)")
    else:
        remaining = int(exp - now)
        print(f"  status:          ✅ VALID (expires in {remaining}s)")

    # ── IDENTITY ─────────────────────────────────────────────
    print(f"\n{sep}")
    print("  IDENTITY CLAIMS")
    print(sep)
    print(f"  sub:               {payload.get('sub')}")
    print(f"    ↑ Canonical user ID — use this as FK in your database")
    print(f"    (does NOT change if user changes email or username)")
    print(f"  preferred_username: {payload.get('preferred_username')}")
    print(f"  email:              {payload.get('email')}")
    print(f"  email_verified:     {payload.get('email_verified')}")
    print(f"  name:               {payload.get('name')}")

    # ── TOKEN METADATA ───────────────────────────────────────
    print(f"\n{sep}")
    print("  TOKEN METADATA")
    print(sep)
    print(f"  iss: {payload.get('iss')}")
    print(f"    ↑ Issuer — API must verify this matches expected realm")
    print(f"  aud: {payload.get('aud')}")
    print(f"    ↑ Audience — API must verify it appears here")
    print(f"  azp: {payload.get('azp')}")
    print(f"    ↑ Authorized party — which client requested this token")
    print(f"  jti: {payload.get('jti')}")
    print(f"    ↑ JWT ID — unique token identifier (for blacklisting)")
    print(f"  sid: {payload.get('sid')}")
    print(f"    ↑ Session ID — same for all tokens in one SSO session")
    print(f"  acr: {payload.get('acr')}")
    print(f"    ↑ Auth level: '1'=password, '2'=MFA completed")

    # ── AUTHORIZATION ────────────────────────────────────────
    print(f"\n{sep}")
    print("  AUTHORIZATION CLAIMS")
    print(sep)
    realm_roles = payload.get("realm_access", {}).get("roles", [])
    resource_access = payload.get("resource_access", {})
    print(f"  realm_access.roles: {realm_roles}")
    print(f"    ↑ Global roles — valid across all apps in this realm")
    if resource_access:
        print(f"  resource_access:")
        for client, data in resource_access.items():
            print(f"    {client}: {data.get('roles', [])}")
        print(f"    ↑ Client-specific roles — valid only for that client")
    print(f"  scope: {payload.get('scope')}")
    print(f"    ↑ Granted scopes determine which claims appear in the token")

    # ── CUSTOM CLAIMS ────────────────────────────────────────
    standard_claims = {
        "sub", "iss", "aud", "exp", "iat", "jti", "nbf",
        "typ", "azp", "sid", "acr", "nonce", "at_hash",
        "realm_access", "resource_access", "scope",
        "preferred_username", "given_name", "family_name",
        "name", "email", "email_verified",
        "allowed-origins", "session_state",
    }
    custom = {k: v for k, v in payload.items() if k not in standard_claims}
    if custom:
        print(f"\n{sep}")
        print("  CUSTOM CLAIMS (added via Protocol Mappers)")
        print(sep)
        for k, v in custom.items():
            print(f"  {k}: {v}")

    # ── SIGNATURE VERIFICATION ───────────────────────────────
    if verify:
        print(f"\n{sep}")
        print("  SIGNATURE VERIFICATION")
        print(sep)
        valid = verify_signature(token)
        if valid:
            print("  ✅ Signature valid — token was signed by this Keycloak realm")
        else:
            print("  ❌ Signature invalid or could not verify")

    # ── RAW PAYLOAD ──────────────────────────────────────────
    print(f"\n{sep}")
    print("  RAW PAYLOAD (complete)")
    print(sep)
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Decode and analyze a Keycloak JWT")
    parser.add_argument("--token", help="JWT to decode (fetches fresh one if not provided)")
    parser.add_argument("--verify", action="store_true", help="Verify signature via JWKS")
    args = parser.parse_args()

    token = args.token or get_fresh_token()
    if not args.token:
        print("Fetched fresh token from Keycloak (user: jdoe)")

    analyze(token, verify=args.verify)


if __name__ == "__main__":
    main()
