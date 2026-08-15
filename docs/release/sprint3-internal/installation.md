# Install the Unsigned Sprint 3 Internal Build

These packages are internal, unsigned, and manually distributed. They are not notarized, code-signed, published to an update feed, or automatically replaced. Install only a package listed in the held `artifact-index.json` and supplied through the approved internal release channel.

## Before installing

1. Preserve any existing WePrompt data using the team's approved backup process. Do not delete or reset existing data to make an installation succeed.
2. Confirm the machine matches an approved target: Windows x64 or Apple-silicon macOS ARM64. macOS x64 is out of scope.
3. Compute the package SHA-256 and compare it character-for-character with `artifact-index.json`. Stop on any mismatch.
4. Confirm the artifact index says `internal: true`, `unsigned: true`, and lists the expected exact WePrompt and AionCore commits.

## Windows x64

1. Use a clean Windows 11 x64 machine or reverted test snapshot.
2. Run the verified `.exe` from the approved internal location.
3. Windows may show an unsigned or unknown-publisher warning. Confirm the filename and SHA-256 again, then use the standard Windows option to continue only if both match the held index.
4. Do not disable endpoint protection, the firewall, authentication controls, or system policy. If policy blocks the package, stop and contact the WePrompt internal release owner.
5. Install for the current user using the package defaults, launch once, and record the displayed build identity for `S01_INSTALL`.

Uninstall through **Settings > Apps > Installed apps > WePrompt > Uninstall**. Uninstallation is not authorization to delete user data; preserve it unless the release owner provides a verified removal procedure.

## macOS ARM64

1. Use an Apple-silicon Mac with a clean or reverted acceptance environment.
2. Open the verified `.dmg` and copy WePrompt to `/Applications` using the normal Finder flow.
3. macOS may block the first launch because the application is unsigned and not notarized. Confirm the package SHA-256 again, then use **System Settings > Privacy & Security > Open Anyway** for this exact application if organizational policy permits.
4. Do not globally disable Gatekeeper or other security controls. If policy does not permit the exception, stop and contact the WePrompt internal release owner.
5. Launch once and record the displayed build identity for `S01_INSTALL`.

Uninstall by quitting WePrompt and moving only `/Applications/WePrompt.app` to Trash. Do not remove application-support data unless the release owner supplies a verified data-removal procedure.

## Manual replacement and support

There is no auto-update path in this release. A later build must be verified and installed manually under its own artifact index and acceptance evidence. For hash mismatches, policy blocks, install failures, unexpected update behavior, or data-access problems, stop and contact the WePrompt internal release owner; preserve logs and affected fixtures in sanitized, controlled storage.
