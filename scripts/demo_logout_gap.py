#!/usr/bin/env python3
"""
demo_logout_gap.py — Demonstrates the JWT logout gap.

The core trade-off of stateless JWT:
  - An API validating JWT locally does NOT know the session was closed.
  - Only token introspection reflects the real session state.

Run this script end-to-end in < 30 seconds to see all steps
before the token expires.

Usage:
  python3 scripts/demo_logout_gap.py
"""
import base64
import json
import time
import requests
from datetime import datetime

KC_URL    = "http://localhost:8080"
REALM     = "acmecorp"
BASE      = f"{KC_URL}/realms/{REALM}/protocol/openid-connect"
CLIENT_ID = "acmecorp-portal"
CLIENT_SECRET = "portal-secret-local"


def decode_payload(token: str) -> dict:
    p = token.split(".")[1]
    p += "=" * (4 - len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p))


def step(n: int, title: str) -> None:
    print(f"\n{'─' * 55}")
    print(f"  STEP {n}: {title}")
    print("─" * 55)


def main():
    print("\n" + "═" * 55)
    print("  JWT LOGOUT GAP — Live Demonstration")
    print("═" * 55)
    print("  Run end-to-end in < 30s (token TTL is 300s)")

    # STEP 1 — Get token
    step(1, "Obtain JWT token")
    r = requests.post(f"{BASE}/token", data={
        "grant_type":    "password",
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "username":      "jdoe",
        "password":      "Test1234!",
    })
    d = r.json()
    if "access_token" not in d:
        print(f"  ❌ Could not get token: {d}")
        return

    token = d["access_token"]
    payload = decode_payload(token)
    exp = datetime.fromtimestamp(payload["exp"])

    print(f"  ✅ Token issued for: {payload.get('preferred_username')}")
    print(f"  Session ID:   {payload.get('sid')}")
    print(f"  Expires at:   {exp}")
    print(f"  TTL:          {d.get('expires_in')}s")
    print(f"  Token prefix: {token[:30]}...")

    # STEP 2 — Use token before logout
    step(2, "Use token — BEFORE logout")
    r = requests.get(f"{BASE}/userinfo",
                     headers={"Authorization": f"Bearer {token}"})
    if r.status_code == 200:
        print(f"  ✅ UserInfo HTTP {r.status_code}: user = {r.json().get('preferred_username')}")
    else:
        print(f"  ❌ HTTP {r.status_code}: {r.text}")

    # STEP 3 — Check introspection before logout
    step(3, "Introspection — BEFORE logout")
    r = requests.post(f"{BASE}/token/introspect", data={
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "token":         token,
    })
    intro = r.json()
    print(f"  active: {intro.get('active')}  ← session is alive")

    # STEP 4 — Logout
    step(4, "Logout — close session in Keycloak")
    r = requests.post(f"{BASE}/logout",
                      headers={"Authorization": f"Bearer {token}"},
                      data={
                          "client_id":     CLIENT_ID,
                          "client_secret": CLIENT_SECRET,
                      })
    print(f"  HTTP {r.status_code} — session closed in Keycloak")

    # STEP 5 — Use same token immediately after logout
    step(5, "Use SAME token — AFTER logout (immediate)")
    r = requests.get(f"{BASE}/userinfo",
                     headers={"Authorization": f"Bearer {token}"})
    print(f"  UserInfo HTTP {r.status_code}")
    if r.status_code == 200:
        print(f"  ⚠️  STILL WORKS: user = {r.json().get('preferred_username')}")
        print(f"  ← JWT is cryptographically valid until exp")
        print(f"  ← UserInfo validates the JWT signature, not the session state")
    else:
        print(f"  ✅ Rejected (token already expired)")

    # STEP 6 — Introspection after logout
    step(6, "Introspection — AFTER logout")
    r = requests.post(f"{BASE}/token/introspect", data={
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "token":         token,
    })
    intro = r.json()
    print(f"  active: {intro.get('active')}  ← session is gone")
    if not intro.get("active"):
        print(f"  ✅ Keycloak knows the session ended")
        print(f"  ← Introspection checks real session state, not just the JWT")

    # CONCLUSION
    print(f"\n{'═' * 55}")
    print("  CONCLUSION")
    print("═" * 55)
    print("""
  Method              After logout  Latency   Use case
  ──────────────────────────────────────────────────────
  Local JWT validate   ✅ valid ⚠️   0ms       Normal APIs
  UserInfo endpoint    ✅ valid ⚠️   ~10ms     User info
  Introspection        ❌ invalid ✅  ~10ms     Critical APIs
  ──────────────────────────────────────────────────────

  Enterprise strategies:
    ① TTL = 300s  → acceptable risk window for most apps
    ② Introspection on sensitive endpoints (banking, health)
    ③ Backchannel logout → Keycloak notifies all apps on logout
  """)


if __name__ == "__main__":
    main()
