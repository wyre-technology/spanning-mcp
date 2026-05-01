# Spanning Cloud Backup MCP Server

[![CI](https://github.com/wyre-technology/spanning-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/wyre-technology/spanning-mcp/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A [Model Context Protocol](https://modelcontextprotocol.io) server exposing the
[Spanning Cloud Backup](https://spanning.com/) API to Claude and other MCP
clients.

## What it does

Surface SaaS backup posture for your M365, Google Workspace, or Salesforce
tenants directly to AI assistants — list backed-up users, inspect covered
services, browse backup history, queue restores, and audit admin activity and
license usage.

## Tools

| Tool | Purpose |
| --- | --- |
| `spanning_list_users` | List backed-up users in the org |
| `spanning_get_user` | Fetch a single user's detail |
| `spanning_list_services` | List services covered for a user |
| `spanning_list_backups` | List backup runs for a user + service |
| `spanning_queue_restore` | Queue a restore (DESTRUCTIVE — requires confirmation) |
| `spanning_get_restore_status` | Check restore progress |
| `spanning_list_audit_log` | Admin audit log (date-range elicitation) |
| `spanning_get_license_usage` | Seats used vs purchased |
| `spanning_status` | Server status / health |

## Credentials

### Local (env mode)

```sh
export SPANNING_PLATFORM="m365"        # or "gws" or "salesforce"
export SPANNING_ADMIN_EMAIL="..."
export SPANNING_API_TOKEN="..."
```

### Hosted (gateway mode)

The WYRE MCP Gateway injects credentials per request via headers:

- `X-Spanning-Platform` (required, one of `m365` | `gws` | `salesforce`)
- `X-Spanning-Admin-Email` (required)
- `X-Spanning-API-Token` (required, secret)

## Run

```sh
npm install
npm run build
npm start                       # stdio
MCP_TRANSPORT=http npm start    # HTTP on :8080
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
