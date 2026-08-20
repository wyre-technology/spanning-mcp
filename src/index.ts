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
import { setServerRef } from "./utils/server-ref.js";
import { TOOL_DEFINITIONS } from "./tool.definitions.js";
import { registerResourceHandlers } from "./resources.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";
import {
  handleSpanningTool,
  type SpanningCredentials,
  type SpanningPlatform,
  type CredentialError,
} from "./tool-handler.js";

const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || "";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const VALID_PLATFORMS: readonly SpanningPlatform[] = ["m365", "gws", "salesforce"];

function isValidPlatform(value: string | undefined): value is SpanningPlatform {
  return !!value && (VALID_PLATFORMS as readonly string[]).includes(value);
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
        resources: {},
      },
    }
  );

  setServerRef(server);
  registerResourceHandlers(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
  });

  // -------------------------------------------------------------------------
  // Tool call handler — logic lives in tool-handler.ts (testable in
  // isolation; this module boots a real transport at import time via main()
  // below, so it can't be imported directly by a test).
  // -------------------------------------------------------------------------

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const credsOrErr = credentialOverrides ?? getCredentials();
    return handleSpanningTool(name, args, credsOrErr);
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
      if (S2S_SECRET && !verifyS2sHeader(req.headers[S2S_HEADER] as string | undefined, S2S_SECRET)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
          })
        );
        return;
      }

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
