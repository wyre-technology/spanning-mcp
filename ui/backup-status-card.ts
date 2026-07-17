/**
 * Iframe bridge + renderer for the Spanning backup status card (MCP Apps,
 * SEP-1865).
 *
 * Runs inside the host's sandboxed iframe. Uses the official MCP Apps client
 * (`App`) to receive the spanning_get_user tool result from the host. The
 * card is read-only — it renders backup posture and offers no write actions.
 *
 * The server attaches a normalized `_card` payload to spanning_get_user
 * results (see src/card.builder.ts) so this renderer never needs to resolve
 * platform codes or fetch services itself.
 *
 * Rendering uses DOM construction (no innerHTML) — user names, emails, and
 * service names are untrusted vendor data, so text only ever lands in text
 * nodes.
 *
 * Branding: the card is neutral by default (this is a published server) and
 * applies an injected `window.__BRAND__` override — set by the server from
 * MCP_BRAND_* env vars at serve time, or by a gateway per-org — so the same
 * card can render in any operator's brand.
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface Brand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}
declare global {
  interface Window {
    __BRAND__?: Brand;
  }
}

/** Mirror of BackupStatusCard in src/card.builder.ts — keep in sync. */
interface BackupStatusCard {
  id: string;
  displayName?: string;
  email?: string;
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

const brand: Brand = window.__BRAND__ ?? {};
// No brand injected → no brand identity rendered (neutral default).
const brandName = brand.name ?? "";

// Apply any injected brand overrides onto the CSS custom properties.
function applyBrand(): void {
  const root = document.documentElement.style;
  if (brand.primaryColor) root.setProperty("--brand-primary", brand.primaryColor);
  if (brand.accentColor) root.setProperty("--brand-accent", brand.accentColor);
  if (brand.bg) root.setProperty("--brand-bg", brand.bg);
  if (brand.text) root.setProperty("--brand-text", brand.text);
}

const app = new App({ name: "Spanning Backup Status Card", version: "1.0.0" });

/** Create an element with a class and (safe, text-node) children. */
function el(
  tag: string,
  className = "",
  ...children: Array<Node | string | null>
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null) continue;
    node.append(child); // strings become text nodes — never parsed as HTML
  }
  return node;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function field(label: string, value: string | undefined): HTMLElement | null {
  if (!value) return null;
  return el(
    "div",
    "field",
    el("div", "field__label", label),
    el("div", "field__value", value),
  );
}

function badge(text: string | undefined, cls: string): HTMLElement | null {
  return text ? el("span", `badge ${cls}`, text) : null;
}

function serviceEl(s: BackupStatusCard["services"][number]): HTMLElement {
  const meta: string[] = [];
  if (s.lastBackupAt) meta.push(fmtDate(s.lastBackupAt));
  if (s.itemCount != null) meta.push(`${s.itemCount} items`);
  return el(
    "div",
    s.enabled === false ? "service service--disabled" : "service",
    el("span", "dot"),
    el("span", "service__name", s.name),
    meta.length > 0 ? el("span", "service__meta", meta.join(" · ")) : null,
  );
}

function render(c: BackupStatusCard): void {
  // Empty when no brand is injected — the span still occupies the flex slot
  // so the source label stays right-aligned.
  const brandId = el("span", "brandid");
  if (brand.logoUrl) {
    const logo = document.createElement("img");
    logo.src = brand.logoUrl;
    logo.alt = brandName || "logo";
    logo.style.display = "inline-block";
    brandId.append(logo);
  }
  if (brandName) brandId.append(el("span", "brand", brandName));

  const servicesSection = el(
    "div",
    "services",
    el("div", "services__h", `Protected services (${c.services.length})`),
  );
  for (const s of c.services) servicesSection.append(serviceEl(s));

  const licensedBadge =
    c.licensed == null ? null : badge(c.licensed ? "Licensed" : "Unlicensed", "badge--licensed");

  const body = el(
    "div",
    "card__body",
    el("div", "brandrow", brandId, el("span", "source", `${c.platform ?? ""} · Spanning Backup`)),
    el("h1", "", c.displayName || c.email || c.id),
    el("div", "badges", badge(c.status, "badge--status"), licensedBadge),
    el(
      "div",
      "grid",
      field("Email", c.email),
      field("User ID", c.id),
      field("Platform", c.platform),
      field("Last backup", c.lastBackupAt && fmtDate(c.lastBackupAt)),
    ),
    servicesSection,
  );

  const root = document.getElementById("root")!;
  root.replaceChildren(el("div", "card", el("div", "card__bar"), body));
}

// spanning-mcp returns the raw user JSON and attaches the normalized card to
// spanning_get_user results as a top-level `_card` field.
function extractCard(obj: unknown): BackupStatusCard | null {
  const card = (obj as { _card?: BackupStatusCard } | null)?._card;
  return card && typeof card.id === "string" && Array.isArray(card.services) ? card : null;
}

applyBrand();

// Must be set before connect() so the initial tool-result isn't missed.
app.ontoolresult = (result: { content?: Array<{ type: string; text?: string }> }) => {
  const payload = (result.content ?? []).find((c) => c.type === "text");
  if (!payload?.text) return;
  try {
    const card = extractCard(JSON.parse(payload.text));
    if (card) render(card);
  } catch {
    /* ignore malformed payloads */
  }
};

app.connect();
