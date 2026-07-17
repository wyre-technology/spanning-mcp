/**
 * MCP resource handlers for the Spanning Cloud Backup MCP server.
 *
 * Exposes the MCP Apps (SEP-1865) backup-status-card UI via ListResources and
 * ReadResource handlers. The card HTML is embedded at build time
 * (src/generated/backup-status-card-html.ts) so it serves identically from
 * stdio and HTTP transports without touching the filesystem.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  BACKUP_STATUS_CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
  applyBrandInjection,
  resolveBrandFromEnv,
} from "./card.builder.js";
import { BACKUP_STATUS_CARD_HTML } from "./generated/backup-status-card-html.js";

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export function listResources(): McpResource[] {
  return [
    {
      uri: BACKUP_STATUS_CARD_RESOURCE_URI,
      name: "Spanning Backup Status Card",
      description:
        "Interactive MCP Apps card rendering a backed-up user's backup status",
      mimeType: MCP_APP_RESOURCE_MIME,
    },
  ];
}

export function readResource(uri: string): McpResourceContent {
  if (uri === BACKUP_STATUS_CARD_RESOURCE_URI) {
    return {
      uri,
      mimeType: MCP_APP_RESOURCE_MIME,
      // Neutral by default; MCP_BRAND_* env vars inject a per-operator brand
      // at serve time (no rebuild needed). Empty brand = HTML served as-is.
      text: applyBrandInjection(BACKUP_STATUS_CARD_HTML, resolveBrandFromEnv()),
    };
  }
  throw new Error(`Unknown resource: ${uri}`);
}

export function registerResourceHandlers(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
    contents: [readResource(request.params.uri)],
  }));
}
