# macOS ARM Setup (Apple Silicon M1/M2/M3)

This lab runs on any platform. This document covers the specific
adjustments needed on Apple Silicon Macs.

---

## Docker Desktop — minimum resources

```
CPU:    4 cores
Memory: 6 GB   ← critical, Keycloak needs headroom
Swap:   1 GB
```

Go to: **Docker Desktop → Settings → Resources → Apply & Restart**

---

## OpenLDAP on ARM

The `osixia/openldap` image has no native ARM64 build.
It runs in x86_64 emulation mode on Apple Silicon.

The `docker-compose.yml` already includes the required directive:

```yaml
openldap:
  image: osixia/openldap:1.5.0
  platform: linux/amd64   ← required on ARM, remove on Linux x86_64
```

You will see this warning when pulling — it is harmless:
```
The requested image's platform (linux/amd64) does not match the 
detected host platform (linux/arm64/v8)
```

The same applies to `phpldapadmin` and `mailhog` — they run fine in emulation.

---

## OpenLDAP bootstrap LDIFs

**Problem:** `osixia/openldap` runs `rm -rf` on its bootstrap LDIF directory
after processing it during container init. Docker Desktop on macOS prevents
deleting bind-mounted directories from inside a container:

```
rm: cannot remove '.../ldif/custom': Device or resource busy
ERROR: /container/run/startup/slapd failed with status 1
```

**Solution:** Don't bind-mount the bootstrap directory.
Load the LDIFs manually after the container starts:

```bash
bash scripts/02_load_ldap.sh
```

This script copies the LDIF files into the container with `docker cp`
and loads them with `ldapadd`. It is idempotent — safe to run multiple times.

> **Note:** This issue is specific to macOS Docker Desktop.
> On Linux, bind-mounting the bootstrap directory works without issues.

---

## Project location

Run this project from your home directory or any local path:

```bash
~/keycloak-iam-lab/   ✅
~/Developer/iam/      ✅
```

Avoid paths with spaces or special characters in the directory name,
as they can cause issues with Docker volume mounts and shell scripts.

---

## Verified environment

```
macOS:          Sonoma 14.x
Chip:           Apple M3
Docker Desktop: 4.x with Rosetta enabled
Docker:         29.x
Docker Compose: v2.x (command: docker compose, not docker-compose)
```
