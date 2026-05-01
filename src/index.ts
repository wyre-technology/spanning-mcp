#!/usr/bin/env node
/**
 * Spanning Cloud Backup MCP Server
 *
 * This MCP server provides tools for interacting with the Spanning Cloud
 * Backup API (M365 / Google Workspace / Salesforce). It accepts credentials
 * via environment variables (env mode) or per-request HTTP headers (gateway
 * mode).
 *
 * Supports both stdio (default) and HTTP (StreamableHTTP) transports.
 */

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SpanningClient } from "@wyre-technology/node-spanning";
import { setServerRef } from "./utils/server-ref.js";
import { elicitConfirmation, elicitSelection, elicitText } from "./utils/elicitation.js";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const VALID_PLATFORMS = ["m365", "gws", "salesforce"] as const;
type SpanningPlatform = (typeof VALID_PLATFORMS)[number];

interface SpanningCredentials {
  platform: SpanningPlatform;
  adminEmail: string;
  apiToken: string;
}

function isValidPlatform(value: string | undefined): value is SpanningPlatform {
  return !!value && (VALID_PLATFORMS as readonly string[]).includes(value);
}

interface CredentialError {
  status: number;
  body: Record<string, unknown>;
}

function getCredentials(): SpanningCredentials | CredentialError | null {
  const platform = process.env.SPANNING_PLATFORM;
  const adminEmail = process.env.SPANNING_ADMIN_EMAIL;
  const apiToken = process.env.SPANNING_API_TOKEN;

  if (!platform && !adminEmail && !apiToken) return null;

  const missing: string[] = [];
  if (!platform) missing.push("SPANNING_PLATFORM");
  if (!adminEmail) missing.push("SPANNING_ADMIN_EMAIL");
  if (!apiToken) missing.push("SPANNING_API_TOKEN");
  if (missing.length > 0) {
    return {
      status: 401,
      body: { error: "Missing credentials", required: missing },
    };
  }
  if (!isValidPlatform(platform)) {
    return {
      status: 400,
      body: {
        error: "Invalid platform",
        message: `SPANNING_PLATFORM must be one of: ${VALID_PLATFORMS.join(", ")}`,
        validValues: VALID_PLATFORMS,
      },
    };
  }
  return { platform, adminEmail: adminEmail!, apiToken: apiToken! };
}

function createClient(creds: SpanningCredentials): SpanningClient {
  return new SpanningClient({
    platform: creds.platform,
    adminEmail: creds.adminEmail,
    apiToken: creds.apiToken,
  });
}

// ---------------------------------------------------------------------------
// Server factory — fresh server per request (stateless HTTP mode)
// ---------------------------------------------------------------------------

function createMcpServer(credentialOverrides?: SpanningCredentials): Server {
  const server = new Server(
    {
      name: "spanning-mcp",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  setServerRef(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
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
      ],
    };
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const DATE_FILTER_PAGE_CAP = 2000;

  interface DateRangeMs {
    sinceMs?: number;
    untilMs?: number;
  }

  function normalizeTs(raw: number): number {
    return raw < 1e12 ? raw * 1000 : raw;
  }

  function filterByDate<T extends { createdAt?: number | string; timestamp?: number | string }>(
    items: T[],
    range: DateRangeMs
  ): T[] {
    const sinceMs = range.sinceMs ?? -Infinity;
    const untilMs = range.untilMs ?? Infinity;
    const out: T[] = [];
    for (const item of items) {
      const raw = item.createdAt ?? item.timestamp;
      if (raw != null) {
        const numeric = typeof raw === "string" ? Date.parse(raw) : normalizeTs(raw);
        if (!Number.isNaN(numeric) && (numeric < sinceMs || numeric > untilMs)) continue;
      }
      out.push(item);
      if (out.length >= DATE_FILTER_PAGE_CAP) break;
    }
    return out;
  }

  async function resolveDateRange(
    args: { since?: string; until?: string }
  ): Promise<DateRangeMs> {
    if (args.since || args.until) {
      return {
        sinceMs: args.since ? new Date(args.since).getTime() : undefined,
        untilMs: args.until ? new Date(args.until).getTime() : undefined,
      };
    }

    const choice = await elicitSelection(
      "No date range provided. This query can return many results. Choose a window:",
      "range",
      [
        { value: "24h", label: "Last 24 hours" },
        { value: "7d", label: "Last 7 days" },
        { value: "30d", label: "Last 30 days" },
        { value: "custom", label: "Enter custom ISO 8601 dates" },
        { value: "all", label: "No filter (return everything)" },
      ]
    );

    const nowMs = Date.now();
    const PRESET_WINDOWS_MS: Record<string, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    if (!choice || choice === "all") return {};
    if (choice in PRESET_WINDOWS_MS) {
      return { sinceMs: nowMs - PRESET_WINDOWS_MS[choice] };
    }
    if (choice === "custom") {
      const since = await elicitText(
        "Enter the start datetime in ISO 8601 format (e.g. 2025-04-01T00:00:00Z).",
        "since",
        "Start datetime"
      );
      const until = await elicitText(
        "Enter the end datetime in ISO 8601 format (leave blank for now).",
        "until",
        "End datetime"
      );
      return {
        sinceMs: since ? new Date(since).getTime() : undefined,
        untilMs: until ? new Date(until).getTime() : undefined,
      };
    }
    return {};
  }

  function isNotImplemented(error: unknown): boolean {
    if (!error) return false;
    const name = (error as { name?: string }).name ?? "";
    const message = error instanceof Error ? error.message : String(error);
    return (
      name === "NotImplementedError" ||
      /not[\s_-]?implemented/i.test(message)
    );
  }

  // -------------------------------------------------------------------------
  // Tool call handler
  // -------------------------------------------------------------------------

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const credsOrErr = credentialOverrides ?? getCredentials();

    if (!credsOrErr) {
      return {
        content: [
          {
            type: "text",
            text:
              "Error: No Spanning credentials provided. Please set SPANNING_PLATFORM, SPANNING_ADMIN_EMAIL, and SPANNING_API_TOKEN environment variables, or pass them as gateway headers.",
          },
        ],
        isError: true,
      };
    }

    if ("status" in credsOrErr) {
      return {
        content: [{ type: "text", text: `Error: ${JSON.stringify(credsOrErr.body)}` }],
        isError: true,
      };
    }

    const creds = credsOrErr;

    // spanning_status doesn't require an API call
    if (name === "spanning_status") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "ok",
                server: "spanning-mcp",
                version: "0.0.0",
                platform: creds.platform,
                adminEmail: creds.adminEmail,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const client = createClient(creds);

    try {
      switch (name) {
        case "spanning_list_users": {
          const params = (args ?? {}) as { limit?: number };
          const result = await client.users.list({ limit: params.limit ?? 100 });
          return { content: [{ type: "text", text: JSON.stringify(result ?? [], null, 2) }] };
        }

        case "spanning_get_user": {
          const { userId } = args as { userId: string };
          const user = await client.users.get(userId);
          return { content: [{ type: "text", text: JSON.stringify(user ?? {}, null, 2) }] };
        }

        case "spanning_list_services": {
          const { userId } = args as { userId: string };
          const services = await client.services.list(userId);
          return { content: [{ type: "text", text: JSON.stringify(services ?? [], null, 2) }] };
        }

        case "spanning_list_backups": {
          const { userId, service } = args as { userId: string; service: string };
          const backups = await client.backups.list(userId, service);
          return { content: [{ type: "text", text: JSON.stringify(backups ?? [], null, 2) }] };
        }

        case "spanning_queue_restore": {
          const { userId, service, items } = args as {
            userId: string;
            service: string;
            items: string[];
          };
          const confirmed = await elicitConfirmation(
            `About to QUEUE A RESTORE for user ${userId} (service: ${service}, ${items.length} item(s)).\n\n` +
              "This writes data back into the target M365 / Google Workspace / Salesforce tenant. " +
              "The destination account must have appropriate Microsoft Graph / Google API / Salesforce " +
              "permissions for the restore to land successfully.\n\nProceed?"
          );
          if (confirmed !== true) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    confirmed === null
                      ? "Restore cancelled: client does not support confirmation prompts. Pass an explicit confirm flag from a different client to proceed."
                      : "Restore cancelled by user.",
                },
              ],
              isError: true,
            };
          }
          const restore = await client.restores.queue(userId, service, { items });
          return { content: [{ type: "text", text: JSON.stringify(restore ?? {}, null, 2) }] };
        }

        case "spanning_get_restore_status": {
          const { restoreId } = args as { restoreId: string };
          const status = await client.restores.get(restoreId);
          return { content: [{ type: "text", text: JSON.stringify(status ?? {}, null, 2) }] };
        }

        case "spanning_list_audit_log": {
          const params = (args ?? {}) as { since?: string; until?: string };
          const range = await resolveDateRange(params);
          const audit = await client.audit.list({
            since: range.sinceMs ? new Date(range.sinceMs).toISOString() : undefined,
            until: range.untilMs ? new Date(range.untilMs).toISOString() : undefined,
          });
          const list: Array<{ createdAt?: number | string; timestamp?: number | string }> =
            Array.isArray((audit as { items?: unknown }).items)
              ? ((audit as { items: Array<{ createdAt?: number | string; timestamp?: number | string }> }).items)
              : (Array.isArray(audit)
                  ? (audit as Array<{ createdAt?: number | string; timestamp?: number | string }>)
                  : []);
          const filtered = filterByDate(list, range);
          return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
        }

        case "spanning_get_license_usage": {
          const license = await client.license.get();
          return { content: [{ type: "text", text: JSON.stringify(license ?? {}, null, 2) }] };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNotImplemented(error)) {
        return {
          content: [
            {
              type: "text",
              text: `Not implemented for platform '${creds.platform}': ${message}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Transport: stdio (default)
// ---------------------------------------------------------------------------

async function startStdioTransport(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Spanning Cloud Backup MCP server running on stdio");
}

// ---------------------------------------------------------------------------
// Transport: HTTP (StreamableHTTPServerTransport)
// ---------------------------------------------------------------------------

let httpServer: HttpServer | undefined;

async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const authMode = process.env.AUTH_MODE || "env";
  const isGatewayMode = authMode === "gateway";

  httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Health endpoint - no auth required
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          transport: "http",
          authMode: isGatewayMode ? "gateway" : "env",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed" },
            id: null,
          })
        );
        return;
      }

      // In gateway mode, extract credentials from headers and pass directly
      // to avoid process.env race conditions under concurrent load.
      let gatewayCredentials: SpanningCredentials | undefined;
      if (isGatewayMode) {
        const headers = req.headers as Record<string, string | string[] | undefined>;
        const platform = headers["x-spanning-platform"] as string | undefined;
        const adminEmail = headers["x-spanning-admin-email"] as string | undefined;
        const apiToken = headers["x-spanning-api-token"] as string | undefined;

        const missing: string[] = [];
        if (!platform) missing.push("X-Spanning-Platform");
        if (!adminEmail) missing.push("X-Spanning-Admin-Email");
        if (!apiToken) missing.push("X-Spanning-API-Token");
        if (missing.length > 0) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Missing credentials",
              message: "Gateway mode requires Spanning credential headers.",
              required: missing,
            })
          );
          return;
        }
        if (!isValidPlatform(platform)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Invalid platform",
              message: `X-Spanning-Platform must be one of: ${VALID_PLATFORMS.join(", ")}`,
              validValues: VALID_PLATFORMS,
            })
          );
          return;
        }

        gatewayCredentials = {
          platform,
          adminEmail: adminEmail!,
          apiToken: apiToken!,
        };
      }

      // Stateless: fresh server + transport per request
      const server = createMcpServer(gatewayCredentials);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      server
        .connect(transport as unknown as Transport)
        .then(() => {
          transport.handleRequest(req, res);
        })
        .catch((err) => {
          console.error("MCP transport error:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal error" },
                id: null,
              })
            );
          }
        });

      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });

  await new Promise<void>((resolve) => {
    httpServer!.listen(port, host, () => {
      console.error(`Spanning Cloud Backup MCP server listening on http://${host}:${port}/mcp`);
      console.error(`Health check available at http://${host}:${port}/health`);
      console.error(
        `Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`
      );
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function setupShutdownHandlers(): void {
  const shutdown = async () => {
    console.error("Shutting down Spanning Cloud Backup MCP server...");
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  setupShutdownHandlers();

  const transportType = process.env.MCP_TRANSPORT || "stdio";

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

main().catch(console.error);
