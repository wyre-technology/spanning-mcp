# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial scaffold of the Spanning Cloud Backup MCP server.
- Stdio + HTTP (StreamableHTTP) transports.
- Gateway-mode credential handling via `X-Spanning-Platform` / `X-Spanning-Admin-Email` / `X-Spanning-API-Token` headers.
- 9 tools covering users, services, backups, restores, audit log, license usage, and server status.
- Destructive-action confirmation elicitation for `spanning_queue_restore`.
- Date-range elicitation for `spanning_list_audit_log`.
- Multi-stage `Dockerfile` with GitHub Packages auth via build secret.
- Semantic-release based CI release pipeline (`.github/workflows/release.yml`).
- MCPB packaging script and Smithery registry config.
