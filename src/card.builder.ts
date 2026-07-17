/**
 * Backup-status-card payload builder for the MCP Apps (SEP-1865) UI surface.
 *
 * spanning_get_user results get a normalized `_card` object attached (see
 * index.ts) that the ui:// backup status card renders from. The card is
 * progressive enhancement: every step here is best-effort, and a null return
 * simply means the host renders no card while the JSON payload is unchanged.
 */

import type { SpanningClient } from "@wyre-technology/node-spanning";

export const BACKUP_STATUS_CARD_RESOURCE_URI = "ui://spanning/backup-status-card.html";

/** MCP Apps resource MIME (RESOURCE_MIME_TYPE in @modelcontextprotocol/ext-apps). */
export const MCP_APP_RESOURCE_MIME = "text/html;profile=mcp-app";

/**
 * Tool `_meta` advertising the card. Carries both the canonical flat key
 * (RESOURCE_URI_META_KEY in ext-apps) and the nested form ext-apps'
 * registerAppTool emits, so any MCP Apps host revision finds it.
 */
export const BACKUP_STATUS_CARD_META = {
  "ui/resourceUri": BACKUP_STATUS_CARD_RESOURCE_URI,
  ui: { resourceUri: BACKUP_STATUS_CARD_RESOURCE_URI },
} as const;

/** Mirror of Brand in ui/backup-status-card.ts — keep in sync. */
export interface CardBrand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}

/** The BRAND_INJECT comment marker baked into the card HTML (see ui/index.html). */
const BRAND_INJECT_RE = /<!--\s*BRAND_INJECT:[\s\S]*?-->/;

/**
 * Serve-time brand injection: replace the BRAND_INJECT marker with an inline
 * `window.__BRAND__` script so self-hosters can theme the card without
 * rebuilding the bundle. An empty brand returns the HTML unchanged (the card
 * renders its neutral defaults). `<` is escaped so brand values can never
 * break out of the script tag.
 */
export function applyBrandInjection(html: string, brand: CardBrand): string {
  if (!brand || Object.values(brand).every((v) => !v)) return html;
  const json = JSON.stringify(brand).replace(/</g, "\\u003c");
  return html.replace(BRAND_INJECT_RE, `<script>window.__BRAND__=${json}</script>`);
}

/**
 * Resolve brand overrides from MCP_BRAND_* environment variables. Guarded for
 * runtimes without `process`, where this returns an empty brand and the card
 * serves its neutral defaults.
 */
export function resolveBrandFromEnv(): CardBrand {
  if (typeof process === "undefined" || !process.env) return {};
  const env = process.env;
  const brand: CardBrand = {};
  if (env.MCP_BRAND_NAME) brand.name = env.MCP_BRAND_NAME;
  if (env.MCP_BRAND_LOGO_URL) brand.logoUrl = env.MCP_BRAND_LOGO_URL;
  if (env.MCP_BRAND_PRIMARY_COLOR) brand.primaryColor = env.MCP_BRAND_PRIMARY_COLOR;
  if (env.MCP_BRAND_ACCENT_COLOR) brand.accentColor = env.MCP_BRAND_ACCENT_COLOR;
  if (env.MCP_BRAND_BG) brand.bg = env.MCP_BRAND_BG;
  if (env.MCP_BRAND_TEXT) brand.text = env.MCP_BRAND_TEXT;
  return brand;
}

/** Mirror of BackupStatusCard in ui/backup-status-card.ts — keep in sync. */
export interface BackupStatusCard {
  id: string;
  displayName?: string;
  email?: string;
  /** Human-readable platform label, e.g. "Microsoft 365". */
  platform?: string;
  status?: string;
  licensed?: boolean;
  lastBackupAt?: string;
  services: Array<{
    name: string;
    enabled?: boolean;
    lastBackupAt?: string;
    itemCount?: number;
  }>;
}

/** Human-readable labels for the platform codes the server validates. */
const PLATFORM_LABELS: Record<string, string> = {
  m365: "Microsoft 365",
  gws: "Google Workspace",
  salesforce: "Salesforce",
};

const CARD_SERVICE_LIMIT = 8;
const CARD_TEXT_MAX_LENGTH = 200;

function cardText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.slice(0, CARD_TEXT_MAX_LENGTH);
}

/**
 * Build the renderable backup-status card from a spanning_get_user payload.
 * Per-service backup coverage is fetched best-effort (the same lookup
 * spanning_list_services uses) so the card shows what is actually protected;
 * a failed fetch just renders the card without the service breakdown.
 */
export async function buildBackupStatusCard(
  user: Record<string, unknown>,
  platform: string,
  client: Pick<SpanningClient, "services">
): Promise<BackupStatusCard | null> {
  if (typeof user?.id !== "string" || !user.id) return null;

  const card: BackupStatusCard = {
    id: user.id,
    platform: PLATFORM_LABELS[platform] ?? platform,
    services: [],
  };

  const displayName = cardText(user.displayName);
  const email = cardText(user.email);
  const status = cardText(user.status);
  if (displayName) card.displayName = displayName;
  if (email) card.email = email;
  if (status) card.status = status;
  if (typeof user.licensed === "boolean") card.licensed = user.licensed;
  if (typeof user.lastBackupAt === "string" && user.lastBackupAt) {
    card.lastBackupAt = user.lastBackupAt;
  }

  // Per-service coverage gives the card its backup-posture breakdown.
  try {
    const response = await client.services.list(user.id);
    const items = Array.isArray(response?.items) ? response.items : [];
    card.services = items
      .filter((s) => s && typeof s.name === "string" && s.name)
      .slice(0, CARD_SERVICE_LIMIT)
      .map((s) => {
        const service: BackupStatusCard["services"][number] = {
          name: String(s.name).slice(0, CARD_TEXT_MAX_LENGTH),
        };
        if (typeof s.enabled === "boolean") service.enabled = s.enabled;
        if (typeof s.lastBackupAt === "string" && s.lastBackupAt) {
          service.lastBackupAt = s.lastBackupAt;
        }
        if (typeof s.itemCount === "number") service.itemCount = s.itemCount;
        return service;
      });
  } catch {
    // Best-effort: render the card without the service breakdown rather than
    // failing the tool result.
  }

  return card;
}
