/**
 * Declarative tool definitions for the Spanning Cloud Backup MCP server.
 *
 * Kept separate from index.ts so contract tests can import the definitions
 * without starting a transport. spanning_get_user additionally advertises the
 * MCP Apps (SEP-1865) backup status card via `_meta`.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { BACKUP_STATUS_CARD_META } from "./card.builder.js";

export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: "spanning_list_users",
    description: "List all backed-up users in the Spanning organization.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default: 100)", default: 100 },
      },
    },
  },
  {
    name: "spanning_get_user",
    description: "Get detail for a single backed-up user by ID.",
    _meta: BACKUP_STATUS_CARD_META,
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier" },
      },
      required: ["userId"],
    },
  },
  {
    name: "spanning_list_services",
    description:
      "List the backup services covered for a user (mail, drive, calendar, contacts, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier" },
      },
      required: ["userId"],
    },
  },
  {
    name: "spanning_list_backups",
    description: "List backup runs for a user + service.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier" },
        service: {
          type: "string",
          description:
            "Service name (e.g. mail, drive, calendar, contacts, sites, salesforce)",
        },
      },
      required: ["userId", "service"],
    },
  },
  {
    name: "spanning_queue_restore",
    description:
      "Queue a restore for a user + service. DESTRUCTIVE: writes data back into the target tenant. The destination user must have appropriate Microsoft Graph / Google API / Salesforce permissions for the restore to land. Requires explicit confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier to restore to" },
        service: { type: "string", description: "Service to restore (mail, drive, ...)" },
        items: {
          type: "array",
          description:
            "Items (folder/message/file IDs) to restore. Pass an empty array to restore the entire service.",
          items: { type: "string" },
        },
      },
      required: ["userId", "service", "items"],
    },
  },
  {
    name: "spanning_get_restore_status",
    description: "Check the status / progress of a queued restore.",
    inputSchema: {
      type: "object",
      properties: {
        restoreId: { type: "string", description: "Restore job identifier" },
      },
      required: ["restoreId"],
    },
  },
  {
    name: "spanning_list_audit_log",
    description:
      "List admin audit log entries. If date range is omitted, the user will be prompted.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO 8601 start datetime (optional)" },
        until: { type: "string", description: "ISO 8601 end datetime (optional)" },
      },
    },
  },
  {
    name: "spanning_get_license_usage",
    description: "Get license usage / seat counts vs purchased.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "spanning_status",
    description: "Server status / health — confirms credentials and platform are configured.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];
