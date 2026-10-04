# Enterprise Hardware Locking & Server Migration Guide

This guide describes the cryptographic hardware-anchoring architecture for **GarrisonOS Enterprise Edition**, how to inspect your server's hardware identity, and the official protocol for executing zero-downtime server or virtual machine migrations.

---

## 1. Enterprise Hardware Locking Architecture

GarrisonOS Enterprise Edition is engineered for scaled portfolios, institutional operators, and air-gapped private VPC environments requiring **100% offline execution with zero outbound telemetry**.

To safeguard the intellectual property of the Enterprise Edition in untrusted or isolated execution environments, Enterprise Edition license tokens are **cryptographically anchored to the physical or virtual host machine** via an Ed25519 signature.

### How Hardware Fingerprinting Works

GarrisonOS derives a deterministic, collision-resistant Hardware Fingerprint (`hw_<sha256>`) using native operating system identifiers without external network dependencies:

* **Linux**: Reads `/etc/machine-id` or `/var/lib/dbus/machine-id` (systemd persistent machine identity).
* **Windows**: Reads the Cryptography Machine GUID from `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`.
* **macOS**: Reads the hardware `IOPlatformUUID` via `ioreg`.
* **Containerized Fallback**: Hashes host CPU model, architecture, and network interface MAC addresses.

```
┌────────────────────────────────────────────────────────┐
│               GarrisonOS Host Node                     │
│  Instance ID:          inst_01923a4b... (Storage/DB)   │
│  Hardware Fingerprint: hw_725bb167...   (OS Machine)   │
└────────────────────────────────────────────────────────┘
                           │
       Verified Against Cryptographic Token
                           │
┌────────────────────────────────────────────────────────┐
│               Ed25519 License Payload                  │
│  "licensee":            "Oakridge Realty Partners LLC" │
│  "maxUnits":            5000                           │
│  "instanceId":          "inst_01923a4b..."             │
│  "hardwareFingerprint": "hw_725bb167..."               │
└────────────────────────────────────────────────────────┘
```

If an enterprise key is copied to a different host machine, VM clone, or unapproved container cluster, `verifyLicenseKey()` fails closed with:
```
License is hardware-locked to host "hw_725bb167...", but current host machine is "hw_8d48bb0a...".
If you have migrated host hardware, contact licensing@garrisonos.org to request an advance migration key.
```

---

## 2. Server Migration Protocol & Advance Key Issuance

Because Enterprise licenses are bound to the underlying host hardware, **migrating GarrisonOS to a new physical server, cloud instance, or virtual machine requires a new license key**.

### The 1-Week Migration Overlap Policy

To ensure zero downtime during infrastructure upgrades or cloud migrations, GarrisonOS provides an official **1-Week Parallel Migration Window**:

1. **Advance Request**: Before taking down your existing server (Host A), provision your target server (Host B) and retrieve its identifiers.
2. **Advance Key Delivery**: Contact `licensing@garrisonos.org` with your current contract details and Host B's IDs.
3. **Full-Term New Key**: The GarrisonOS licensing team issues a new Enterprise Key bound to Host B with full duration for your remaining contract term.
4. **7-Day Automatic Expiration on Host A**: The old key on Host A is assigned an automatic expiration timestamp **exactly 7 days after the new key is issued**.
5. **Zero-Downtime Parallel Cutover**:
   - Both Host A and Host B operate simultaneously during the 7-day window.
   - Run database and media replication (`scripts/restore.js`).
   - Validate report generation and operator logins on Host B.
   - Switch DNS records, reverse proxies (Caddy / Nginx), or load balancer targets to Host B.
   - Decommission Host A before the 7-day expiration closes.

```
Day 0: Advance Migration Key Issued for Host B (Full 1-Year Term)
 │     Old Key on Host A re-timestamped to expire on Day 7
 │
 ├──► Parallel Data Transfer & Staging (Host A Active, Host B Testing)
 ├──► DNS Cutover to Host B
 │
Day 7: Old Key on Host A Automatically Expires (Read-Only / Over-Quota)
       Host B continues uninterrupted for full contract duration
```

---

## 3. How to Retrieve Node & Hardware Identifiers

To request an initial Enterprise License or advance Migration Key, run the native fingerprint utility on the target host:

```bash
node scripts/fingerprint.js
```

### Example Output:
```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                   GarrisonOS Node & Hardware Identification                      ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║ Hostname:             prod-svr-02                                                ║
║ Platform:             linux (x64)                                                ║
║ Instance ID:          inst_01923a4b-9c1d-7e2f-0a1b-2c3d4e5f6a7b                  ║
║ Hardware Fingerprint: hw_725bb16716ca4ebeb48e9bb0de61ba76                        ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

### Web GUI Identification & Migration Wizard:
Alternatively, administrators can sign in to the GarrisonOS web console and navigate to **Settings $\to$ Licensing** (`/admin?tab=licensing`):
* **1-Click Copy Buttons**: Instantly copy your **Instance ID** and **Hardware Fingerprint** to your clipboard.
* **"Initiate Server Migration" Action**: Opens an automated migration modal that formats the pre-populated migration request template with your current node identity, target hardware fields, and email instructions for `licensing@garrisonos.org`.

---

## 4. Disaster Recovery & Emergency Failover

* **Standby Warm Spares**: Enterprise contracts with High Availability (HA) or Disaster Recovery (DR) riders may receive pre-authorized secondary keys for cold/warm standby nodes.
* **Emergency Support**: In the event of catastrophic physical hardware failure, emergency key re-issuance is available 24/7 for Enterprise SLA holders via `support@garrisonos.org`.
