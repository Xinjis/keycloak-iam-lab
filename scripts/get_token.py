#!/usr/bin/env python3
"""
get_token.py — Demonstrates all OAuth2 grant types with real tokens.

Usage:
  python3 scripts/get_token.py               # all grant types
  python3 scripts/get_token.py --type cc     # client credentials only
  python3 scripts/get_token.py --type user   # resource owner password only
"""
import argparse
import base64
import json
import requests
from datetime import datetime

KC_URL  = "http://localhost:8080"
REALM   = "acmecorp"
TOKEN_URL = f"{KC_URL}/realms/{REALM}/protocol/openid-connect/token"


def decode_jwt(token: str) -> dict:
    """Decode JWT payload without signature verification (debug only)."""
    if not token or "." not in token:
        return {}
    payload = token.split(".")[1]
    payload += "=" * (4 - len(payload) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return {}


def print_token_summary(label: str, token_response: dict) -> None:
    """Print a human-readable summary of a token response."""
    sep = "─" * 55
    print(f"\n{sep}")
    print(f"  {label}")
    print(sep)

    if "error" in token_response:
        print(f"  ❌ Error: {token_response.get('error_description', token_response['error'])}")
        return

    at = decode_jwt(token_response.get("access_token", ""))

    print(f"  token_type:    {token_response.get('token_type')}")
    print(f"  expires_in:    {token_response.get('expires_in')}s")
    print(f"  scope:         {token_response.get('scope')}")
    print(f"  has_refresh:   {'refresh_token' in token_response}")
    print(f"  has_id_token:  {'id_token' in token_response}")

    if at:
        print(f"\n  ACCESS TOKEN CLAIMS:")
        print(f"    sub:      {at.get('sub', 'N/A')}")
        print(f"    username: {at.get('preferred_username', '(none — service account)')}")
        print(f"    email:    {at.get('email', '(none)')}")
        print(f"    roles:    {at.get('realm_access', {}).get('roles', [])}")
        iat = at.get("iat", 0)
        exp = at.get("exp", 0)
        print(f"    issued:   {datetime.fromtimestamp(iat)}")
        print(f"    expires:  {datetime.fromtimestamp(exp)}")
        print(f"    ttl:      {exp - iat}s")
        print(f"    azp:      {at.get('azp')} (authorized party — who requested it)")
        print(f"    sid:      {at.get('sid', '(none)')} (session id)")


def grant_resource_owner_password() -> dict:
    """
    Resource Owner Password Credentials (ROPC).
    ⚠️  Anti-pattern in production — bypasses MFA.
    Use only for testing/debugging.
    """
    return requests.post(TOKEN_URL, data={
        "grant_type":    "password",
        "client_id":     "acmecorp-portal",
        "client_secret": "portal-secret-local",
        "username":      "jdoe",
        "password":      "Test1234!",
        "scope":         "openid email profile",
    }).json()


def grant_client_credentials() -> dict:
    """
    Client Credentials — for M2M services without a human user.
    ✅ Correct pattern for CRON jobs, microservices, integrations.
    """
    return requests.post(TOKEN_URL, data={
        "grant_type":    "client_credentials",
        "client_id":     "acmecorp-integration",
        "client_secret": "integration-secret-local",
    }).json()


def grant_refresh_token(refresh_token: str) -> dict:
    """
    Refresh Token — silently renew an expired access token.
    The user does not need to re-authenticate.
    """
    return requests.post(TOKEN_URL, data={
        "grant_type":    "refresh_token",
        "client_id":     "acmecorp-portal",
        "client_secret": "portal-secret-local",
        "refresh_token": refresh_token,
    }).json()


def main():
    parser = argparse.ArgumentParser(description="OAuth2 grant type demos")
    parser.add_argument("--type", choices=["all", "user", "cc", "refresh"],
                        default="all", help="Grant type to demonstrate")
    args = parser.parse_args()

    print("\n" + "═" * 55)
    print("  OAUTH2 GRANT TYPES — Live demonstration")
    print("  Realm:", REALM)
    print("═" * 55)

    if args.type in ("all", "user"):
        result = grant_resource_owner_password()
        print_token_summary(
            "GRANT TYPE 1: password (ROPC) — ⚠️  testing only", result
        )
        print("  NOTE: disabled by default — bypasses MFA, exposes credentials to client")
        initial_refresh = result.get("refresh_token")

    if args.type in ("all", "cc"):
        result = grant_client_credentials()
        print_token_summary(
            "GRANT TYPE 2: client_credentials — ✅ for M2M services", result
        )
        print("  NOTE: no user, no refresh token, no id_token")

    if args.type in ("all", "refresh"):
        print("\n" + "─" * 55)
        print("  GRANT TYPE 3: refresh_token — silent renewal")
        print("─" * 55)
        initial = grant_resource_owner_password()
        if "refresh_token" in initial:
            initial_at_prefix = initial["access_token"][:20]
            refreshed = grant_refresh_token(initial["refresh_token"])
            if "access_token" in refreshed:
                refreshed_at_prefix = refreshed["access_token"][:20]
                same = initial_at_prefix == refreshed_at_prefix
                print(f"  Initial  access_token: {initial_at_prefix}...")
                print(f"  Refreshed access_token: {refreshed_at_prefix}...")
                print(f"  Same token? {same} ← each refresh generates a NEW token")
                # Try to reuse old refresh token
                reuse = grant_refresh_token(initial["refresh_token"])
                if "error" in reuse:
                    print(f"  Reuse old refresh_token: ❌ invalid (rotation active)")
                else:
                    print(f"  Reuse old refresh_token: ✅ valid (no rotation configured)")

    print("\n" + "═" * 55)
    print("  SUMMARY")
    print("═" * 55)
    print("""
  Grant type          User  Refresh  M2M   Notes
  ──────────────────────────────────────────────
  password (ROPC)      ✅    ✅      ❌   Anti-pattern, bypasses MFA
  client_credentials   ❌    ❌      ✅   Correct for services
  refresh_token        ✅    ✅      ❌   Silent renewal
  authorization_code   ✅    ✅      ❌   Interactive (browser required)
    """)


if __name__ == "__main__":
    main()
