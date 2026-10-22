# AT-SUITE Security Documentation

This document describes the security architecture, practices, and guidelines for AT-SUITE.

## Overview

AT-SUITE is designed with security as a core principle. The application handles sensitive venue data, user credentials, and provides fleet management capabilities for live event environments. Security is implemented through defense-in-depth across authentication, encryption, network security, and operational practices.

## Security Architecture

### Authentication & Authorization

#### Password Security
- **Hashing:** PBKDF2-SHA256 with 300,000 iterations (increased from 200,000 in 1.20.0)
- **Salting:** Random 16-byte salt per password
- **Comparison:** Constant-time HMAC comparison to prevent timing attacks
- **Policy:** Tech passwords require changing if set by another user
- **Migration:** Automatic rehashing on next sign-in when migrating from older versions

#### Session Management
- **Token Generation:** cryptographically secure random tokens (`secrets.token_urlsafe(48)`, increased from 32 in 1.20.0)
- **Storage:** Tokens stored as SHA-512 hashes in the database (upgraded from SHA-256 in 1.20.0)
- **Backward Compatibility:** Old SHA-256 tokens continue to work until renewed
- **Expiration:** Configurable session lifetime (default: hours-based)
- **Node Authentication:** Token-based with operator assignment
- **WebSocket Authentication:** Single-use tickets (60-second expiry) to prevent token leakage in logs

#### Authorization Model
- **Roles:** viewer, tech, manager, admin (hierarchical permissions)
- **Principals:** account, node, apikey (authentication types)
- **Site Isolation:** Multi-tenant support with site-scoped data
- **Module Permissions:** Feature-level access control
- **Licence Enforcement:** Graceful degradation with 14-day grace period

### Data Protection

#### Encryption at Rest
- **Algorithm:** Fernet (AES-128 in CBC mode with HMAC)
- **Key Management:** Auto-generated key file with 0o600 permissions
- **Encrypted Fields:** Messages, presenter emails/phones, bug reports
- **Key Rotation:** Supported via `reset_keys()` function

#### Database Security
- **Hash Algorithm Tracking:** Database tracks which hash algorithm (sha256/sha512) was used for each token
- **Password Migration:** Automatic rehashing with new iteration count on next sign-in
- **Schema Version:** Current schema 14 (1.20.0)
- **Migration:** Non-breaking - existing tokens remain valid, new tokens use stronger hashing

#### Data in Transit
- **HTTPS:** Supported via Caddy reverse proxy (docker-compose TLS profile)
- **Local Development:** Self-signed Caddy local CA for testing
- **Certificate:** Root cert at `~/AT-SUIT/atsuit-root.crt` for venue laptops

#### Secrets Management
- **No Hardcoded Secrets:** All sensitive data via environment variables
- **Environment Files:** `.env.example` provided, `.env` gitignored
- **GitHub Secrets:** Used in CI/CD workflows
- **Docker Secrets:** Supported in website config (`_secret()` function)
- **Secrets in URLs:** Explicitly prevented and redacted from logs

### API & Web Security

#### Security Headers
- **X-Content-Type-Options:** nosniff
- **Referrer-Policy:** no-referrer (presenter links), same-origin (other pages)
- **X-Frame-Options:** SAMEORIGIN (prevents clickjacking)
- **Content-Security-Policy:** Restricts script/style sources to self with inline support
- **Strict-Transport-Security:** max-age=31536000; includeSubDomains (HTTPS only)
- **Cache-Control:** no-store on auth/setup pages

#### Input Validation
- **Pydantic Models:** Type-safe request validation
- **Email Validation:** Regex pattern validation
- **Length Limits:** Input truncation (e.g., display_name[:120])
- **SQL Injection Prevention:** Parameterized queries only

#### Rate Limiting
- **Login Endpoint:** 20 attempts per minute per IP
- **Account-based:** 200 requests per minute per authenticated account
- **Implementation:** In-memory with thread-safe locking
- **Note:** For multi-worker deployments, consider Redis-backed rate limiting

### Network Security

#### SSH Fleet Management
- **Authentication:** SSH key authentication only (no passwords)
- **Key Storage:** Data volume with 0o600 permissions
- **Command Whitelist:** No arbitrary command execution
- **Admin-Only:** Dangerous commands (reboot, shutdown, update) require admin role
- **Host Key Verification:**
  - Default: `StrictHostKeyChecking=accept-new` (convenience for venue LANs)
  - Enhanced: Upload known_hosts file for fingerprint verification
  - Context: Assumes controlled venue network (e.g., 10.100.70.x)

#### Venue Network Assumptions
- **Controlled Environment:** Admin controls all nodes
- **Internal Network:** Venue LAN assumed trusted (e.g., 10.100.70.x)
- **SSH Access:** Restricted to admin-initiated commands
- **Node Updates:** Self-updating (no server SSH required)

### Container Security

#### Docker Configuration
- **Base Image:** `python:3.12-slim` (minimal attack surface)
- **Non-Root User:** Dedicated `atsuit` user with minimal privileges
- **Security Options:** `no-new-privileges:true` (prevents privilege escalation)
- **Health Check:** 30s interval, 5s timeout (monitors application health)
- **Read-Only:** Static files served read-only where appropriate

#### Dockerfile Best Practices
- **Layer Caching:** Optimized with COPY ordering
- **Minimal Packages:** Only essential system packages
- **User Creation:** Non-root user created during build
- **Permissions:** Data volume owned by atsuit user

### Logging & Monitoring

#### Log Security
- **Secret Redaction:** All HTTP access/error logs filtered via `RedactSecrets`
- **Redacted Parameters:** password, token, key, code, etc.
- **Audit Log:** Comprehensive admin action logging
- **Structured Logging:** Timestamps, actors, actions, details

#### Audit Trail
- **Scope:** All admin actions, fleet commands, authentication events
- **Storage:** Database table with full history
- **Retention:** Configurable (default: no automatic cleanup)
- **Export:** Available for compliance and investigation

### Update & Deployment Security

#### Update Mechanism
- **Backup First:** Automatic backup before any update
- **Health Checks:** 5 consecutive successful health checks required
- **Automatic Rollback:** Failed updates revert to previous version
- **Show-Safe:** Won't update during a live show
- **Signed Releases:** GitHub releases with version verification

#### Deployment Security
- **Build Args:** Version, build number, commit hash, build date
- **Image Signing:** GHCR supports image signing
- **Release Workflow:** Artifact verification in CI/CD
- **Installer Security:** One-liner install from verified GitHub releases

## Security Checklist

### Before Deployment
- [ ] Change default admin password
- [ ] Set up HTTPS (Caddy TLS profile)
- [ ] Configure appropriate session timeout
- [ ] Review and restrict admin accounts
- [ ] Enable message retention if needed
- [ ] Set up backup schedule
- [ ] Review fleet SSH key permissions
- [ ] Test known_hosts upload for production environments

### Operational Security
- [ ] Monitor audit log regularly
- [ ] Review failed login attempts
- [ ] Keep dependencies updated (Dependabot)
- [ ] Run security scans (pip-audit, npm audit)
- [ ] Review bug reports for security issues
- [ ] Test rollback procedure
- [ ] Document incident response plan

### Development Security
- [ ] Never commit secrets or credentials
- [ ] Use environment variables for sensitive data
- [ ] Follow principle of least privilege
- [ ] Validate all user input
- [ ] Use parameterized database queries
- [ ] Test with security scanners
- [ ] Review pull requests for security issues

## Incident Response

### Security Incident Steps
1. **Contain:** Isolate affected systems
2. **Assess:** Determine scope and impact
3. **Preserve:** Collect logs and evidence
4. **Communicate:** Notify stakeholders if needed
5. **Remediate:** Apply fixes and patches
6. **Review:** Document lessons learned

### Emergency Contacts
- **Security Issues:** Report via GitHub Security Advisories
- **Critical Bugs:** Use "Report a bug" in-app (routes to console)
- **Support:** Contact vendor via established channels

## Compliance Considerations

### Data Protection
- **Encryption at Rest:** Fernet (AES-128)
- **Encryption in Transit:** HTTPS/TLS
- **Access Control:** Role-based authentication
- **Audit Trail:** Comprehensive logging
- **Data Retention:** Configurable message retention

### Venue Network Security
- **Internal Assumption:** Venue LAN considered trusted
- **SSH Key Management:** Admin-controlled
- **Fleet Commands:** Whitelisted and audited
- **Node Updates:** Self-updating (no server SSH)

## Threat Model

### Assumptions
- Venue network is controlled (admin manages all nodes)
- Attackers may gain access to venue network but not admin credentials
- Laptops may be lost or stolen (tokens are single-use/expiring)
- Web browser vulnerabilities are a risk (CSP headers mitigate)
- Dependency vulnerabilities are a risk (automated scanning in CI)

### Mitigations
- **Network Compromise:** SSH key authentication, command whitelist
- **Credential Theft:** Session expiration, token hashing, rate limiting
- **Device Theft:** Node tokens expire, operator re-authentication required
- **XSS:** CSP headers, input validation, no-user-content execution
- **Dependency Exploits:** Automated scanning, Dependabot updates

## Security Testing

### Automated Testing
- **CI/CD:** pip-audit, npm audit on every push
- **Dockerfile:** Security checks in CI
- **Unit Tests:** Password security, URL secret prevention
- **Integration Tests:** Auth flows, rate limiting

### Manual Testing
- **Penetration Testing:** Schedule annually or after major changes
- **Code Review:** Security-focused review for sensitive changes
- **Dependency Review:** Review Dependabot PRs promptly
- **Configuration Review:** Audit security settings regularly

## References

- **OWASP Top 10:** https://owasp.org/www-project-top-ten/
- **CIS Benchmarks:** https://www.cisecurity.org/cis-benchmarks
- **Python Security:** https://python.org/about/security/
- **FastAPI Security:** https://fastapi.tiangolo.com/tutorial/security/
- **Docker Security:** https://docs.docker.com/engine/security/

## Version History

- **1.20.0 (2026-10-18):** Major security hardening - PBKDF2 iterations 200k→300k, tokens 32→48 bytes, SHA-256→SHA-512 hashing with backward compatibility
- **1.10.4 (2026-10-18):** Added security headers, rate limiting, SSH host key verification
- **1.10.3:** Earlier security improvements (see CHANGELOG.md)

---

**Last Updated:** 2026-10-18
**Maintained By:** AT NET
**Contact:** security@example.com (replace with actual contact)
