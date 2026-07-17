/**
 * MCP Apps (SEP-1865) contract tests — mirrors the checks an MCP Apps host
 * performs to render the backup status card:
 *   1. the renderable tool advertises the UI resource via _meta
 *   2. the ui:// resource lists and reads back as profile=mcp-app HTML
 *   3. buildBackupStatusCard normalizes a Spanning user into the card payload
 *      the iframe renders from
 * The card is read-only by policy — no write round-trip is advertised.
 */

import { describe, it, expect, vi } from "vitest";
import { TOOL_DEFINITIONS } from "../src/tool.definitions.js";
import { listResources, readResource } from "../src/resources.js";
import {
  buildBackupStatusCard,
  applyBrandInjection,
  BACKUP_STATUS_CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
} from "../src/card.builder.js";
import { BACKUP_STATUS_CARD_HTML } from "../src/generated/backup-status-card-html.js";

const RENDERABLE_TOOLS = ["spanning_get_user"];

describe("MCP Apps backup status card", () => {
  describe("tool _meta advertisement", () => {
    it.each(RENDERABLE_TOOLS)("%s links the card via _meta", (name) => {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
      expect(tool).toBeDefined();
      // Canonical flat key (ext-apps RESOURCE_URI_META_KEY) …
      expect(tool?._meta?.["ui/resourceUri"]).toBe(BACKUP_STATUS_CARD_RESOURCE_URI);
      // … and the nested form registerAppTool also emits.
      expect((tool?._meta?.ui as { resourceUri?: string })?.resourceUri).toBe(
        BACKUP_STATUS_CARD_RESOURCE_URI
      );
    });

    it("no other tools carry UI metadata", () => {
      const others = TOOL_DEFINITIONS.filter(
        (t) => t._meta && !RENDERABLE_TOOLS.includes(t.name)
      );
      expect(others).toEqual([]);
    });
  });

  describe("ui:// resource", () => {
    it("is listed with the MCP Apps MIME type", () => {
      const card = listResources().find((r) => r.uri === BACKUP_STATUS_CARD_RESOURCE_URI);
      expect(card?.mimeType).toBe(MCP_APP_RESOURCE_MIME);
    });

    it("reads back as profile=mcp-app HTML containing the card app", () => {
      const content = readResource(BACKUP_STATUS_CARD_RESOURCE_URI);
      expect(content.mimeType).toBe(MCP_APP_RESOURCE_MIME);
      // No MCP_BRAND_* env set → the embedded HTML is served byte-identical.
      expect(content.text).toBe(BACKUP_STATUS_CARD_HTML);
      expect(content.text).toContain("card__bar");
      expect(content.text).toContain("BRAND_INJECT");
      // The vite build must have inlined the bridge script — a bare <script src>
      // would be unloadable from a resources/read HTML string.
      expect(content.text).not.toContain('src="./backup-status-card.ts"');
    });

    it("serves neutral defaults with no vendor identity", () => {
      const { text } = readResource(BACKUP_STATUS_CARD_RESOURCE_URI);
      expect(text).not.toMatch(/WYRE/i);
      expect(text).not.toContain("00c9db"); // WYRE cyan
      expect(text).not.toContain("ede947"); // WYRE yellow
      expect(text).not.toContain("fonts.googleapis.com"); // no external fetches
    });

    it("injects MCP_BRAND_* env vars into the served HTML", () => {
      vi.stubEnv("MCP_BRAND_NAME", "Acme MSP");
      vi.stubEnv("MCP_BRAND_PRIMARY_COLOR", "#ff0000");
      try {
        const { text } = readResource(BACKUP_STATUS_CARD_RESOURCE_URI);
        expect(text).toContain(
          '<script>window.__BRAND__={"name":"Acme MSP","primaryColor":"#ff0000"}</script>'
        );
        expect(text).not.toContain("BRAND_INJECT");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("rejects unknown resource URIs", () => {
      expect(() => readResource("ui://spanning/nope.html")).toThrow(/Unknown resource/);
    });
  });

  describe("applyBrandInjection", () => {
    const html = BACKUP_STATUS_CARD_HTML;

    it("replaces the marker with an inline window.__BRAND__ script", () => {
      const out = applyBrandInjection(html, { name: "Acme", primaryColor: "#123456" });
      expect(out).toContain('window.__BRAND__={"name":"Acme","primaryColor":"#123456"}');
      expect(out).not.toContain("BRAND_INJECT");
    });

    it("escapes < so brand values cannot break out of the script tag", () => {
      const out = applyBrandInjection(html, { name: "</script><script>alert(1)" });
      expect(out).not.toContain("</script><script>alert(1)");
      expect(out).toContain("\\u003c/script>\\u003cscript>alert(1)");
    });

    it("returns the HTML unchanged for an empty brand", () => {
      expect(applyBrandInjection(html, {})).toBe(html);
      expect(applyBrandInjection(html, { name: "" })).toBe(html);
    });
  });

  describe("buildBackupStatusCard", () => {
    const user = {
      id: "u-4821",
      email: "dana.ruiz@acme.example",
      displayName: "Dana Ruiz",
      status: "active",
      licensed: true,
      lastBackupAt: "2026-07-17T02:00:00Z",
    };

    const mockServicesList = vi.fn(async () => ({
      items: [
        { name: "mail", enabled: true, lastBackupAt: "2026-07-17T02:00:00Z", itemCount: 1204 },
        { name: "drive", enabled: false },
      ],
      next: null,
    }));
    const client = { services: { list: mockServicesList } };

    it("normalizes the user and per-service coverage into the card payload", async () => {
      const card = await buildBackupStatusCard(user, "m365", client as never);
      expect(card).toMatchObject({
        id: "u-4821",
        email: "dana.ruiz@acme.example",
        displayName: "Dana Ruiz",
        platform: "Microsoft 365",
        status: "active",
        licensed: true,
        lastBackupAt: "2026-07-17T02:00:00Z",
        services: [
          { name: "mail", enabled: true, lastBackupAt: "2026-07-17T02:00:00Z", itemCount: 1204 },
          { name: "drive", enabled: false },
        ],
      });
    });

    it("resolves platform codes into human-readable labels", async () => {
      expect((await buildBackupStatusCard(user, "gws", client as never))?.platform).toBe(
        "Google Workspace"
      );
      expect(
        (await buildBackupStatusCard(user, "salesforce", client as never))?.platform
      ).toBe("Salesforce");
    });

    it("returns null for payloads that are not a user", async () => {
      expect(await buildBackupStatusCard({}, "m365", client as never)).toBeNull();
      expect(
        await buildBackupStatusCard({ id: 42 } as never, "m365", client as never)
      ).toBeNull();
    });

    it("skips malformed service entries and caps the list", async () => {
      const noisy = {
        services: {
          list: vi.fn(async () => ({
            items: [
              { name: "mail" },
              { enabled: true }, // no name — dropped
              ...Array.from({ length: 12 }, (_, i) => ({ name: `svc-${i}` })),
            ],
          })),
        },
      };
      const card = await buildBackupStatusCard(user, "m365", noisy as never);
      expect(card?.services).toHaveLength(8);
      expect(card?.services[0]).toEqual({ name: "mail" });
    });

    it("survives service-fetch failures (card is best-effort)", async () => {
      const failing = {
        services: {
          list: vi.fn(async () => {
            throw new Error("Spanning 500");
          }),
        },
      };
      const card = await buildBackupStatusCard(user, "m365", failing as never);
      expect(card).toMatchObject({ id: "u-4821", services: [] });
      expect(card?.status).toBe("active");
    });
  });
});
