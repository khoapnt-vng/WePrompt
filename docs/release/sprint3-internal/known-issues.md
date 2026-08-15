# Sprint 3 Known Issues

This release has one named unresolved P1 issue. Omission is not a disposition.

## BUG-017 — runtime loss of local-data access

- Severity: P1
- Status: runtime classification and recovery UX are unbuilt; the non-destructive safeguard is the only currently proven behavior.
- Affected targets: Windows x64 and macOS ARM64.
- Owner: WePrompt release owner with the AionCore release owner for backend behavior.
- Acceptance scenario: `S09_BUG017` on both platforms.
- Required evidence: direct packaged runtime-loss observation, safeguard result, and a hashed preserved fixture record.

### Preservation-first operator response

If local-data access is lost, stop the affected application session and preserve the data directory or controlled test fixture before retrying. Do not reinstall, reset, delete, repair, migrate, or manually edit the affected data as a troubleshooting shortcut. Record the observed state, platform, package hash, timestamps, and a sanitized fixture hash/location for the owners. Recovery must happen only from a verified copy under owner direction.

This is a safeguard, not completed product recovery. It must not be described as a BUG-017 fix.

### Release disposition

- Plain Go is prohibited while `bug017RuntimeRecoveryBuilt` is `false`.
- Conditional go is admissible only after all other gates and scenarios pass, both platform records show `S09_BUG017: blocked`, the preserved-fixture evidence exists, and the release owner explicitly accepts the P1 residual risk and the preservation-first response.
- No-go is mandatory if BUG-017 causes destructive mutation, the safeguard cannot be demonstrated on either target, required evidence is missing, or the owner does not explicitly accept the residual risk.
- Silence, an absent signature, or a branch/package name is not acceptance.
