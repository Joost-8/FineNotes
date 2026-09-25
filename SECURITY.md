# Security policy

## Supported versions

Only the latest release of FineNotes receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub: **Security → Report a
vulnerability** on this repository. Do not open a public issue for security
problems. Include the steps to reproduce it and the platform involved (desktop
or iOS/iPadOS).

## Notes for reviewers

- **API keys** for the optional AI services are kept in Obsidian's Keychain
  (`app.secretStorage`), not in the vault's files. Each key is stored per
  service and is only ever sent to that service. The key for a self-hosted
  endpoint is never sent anywhere else.
- **Network requests** happen only for the optional AI features, and only to
  the service the user picked. They are listed in the README's "Privacy and
  network use" section. There is no telemetry.
- **Nothing leaves the device unasked.** Transcription, questions, image
  generation and audio transcription run when the user asks for them.
  Automatic transcription is opt-in and off by default. Before the first
  request to a cloud service, and separately before the first request to a
  self-hosted endpoint, the user must agree to a one-time prompt. Without that
  agreement, background runs are skipped.
- **Build provenance.** Release files carry GitHub build-provenance
  attestations. Verify them with
  `gh attestation verify main.js --repo Joost-8/FineNotes`.
