/**
 * Real handler-invocation tests for handleSpanningTool.
 * Mocks the SpanningClient SDK, elicitation, and the card builder so these
 * exercise the tool-handler's own logic (credential gating, request shaping,
 * response mapping, error handling) rather than any real network call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockUsersList,
  mockUsersGet,
  mockServicesList,
  mockBackupsList,
  mockRestoresQueue,
  mockRestoresGet,
  mockAuditList,
  mockLicenseGet,
  mockClient,
} = vi.hoisted(() => {
  const mockUsersList = vi.fn();
  const mockUsersGet = vi.fn();
  const mockServicesList = vi.fn();
  const mockBackupsList = vi.fn();
  const mockRestoresQueue = vi.fn();
  const mockRestoresGet = vi.fn();
  const mockAuditList = vi.fn();
  const mockLicenseGet = vi.fn();
  const mockClient = {
    users: { list: mockUsersList, get: mockUsersGet },
    services: { list: mockServicesList },
    backups: { list: mockBackupsList },
    restores: { queue: mockRestoresQueue, get: mockRestoresGet },
    audit: { list: mockAuditList },
    license: { get: mockLicenseGet },
  };
  return {
    mockUsersList,
    mockUsersGet,
    mockServicesList,
    mockBackupsList,
    mockRestoresQueue,
    mockRestoresGet,
    mockAuditList,
    mockLicenseGet,
    mockClient,
  };
});

vi.mock("@wyre-technology/node-spanning", () => ({
  SpanningClient: vi.fn().mockImplementation(function SpanningClient() {
    return mockClient;
  }),
}));

const { mockElicitConfirmation, mockElicitSelection, mockElicitText } = vi.hoisted(() => ({
  mockElicitConfirmation: vi.fn(),
  mockElicitSelection: vi.fn(),
  mockElicitText: vi.fn(),
}));
vi.mock("../src/utils/elicitation.js", () => ({
  elicitConfirmation: mockElicitConfirmation,
  elicitSelection: mockElicitSelection,
  elicitText: mockElicitText,
}));

const { mockBuildBackupStatusCard } = vi.hoisted(() => ({
  mockBuildBackupStatusCard: vi.fn(),
}));
vi.mock("../src/card.builder.js", () => ({
  buildBackupStatusCard: mockBuildBackupStatusCard,
}));

import { handleSpanningTool, filterByDate } from "../src/tool-handler.js";

const CREDS = { platform: "m365" as const, adminEmail: "admin@acme.example", apiToken: "tok-123" };

describe("handleSpanningTool", () => {
  beforeEach(() => {
    mockUsersList.mockReset();
    mockUsersGet.mockReset();
    mockServicesList.mockReset();
    mockBackupsList.mockReset();
    mockRestoresQueue.mockReset();
    mockRestoresGet.mockReset();
    mockAuditList.mockReset();
    mockLicenseGet.mockReset();
    mockElicitConfirmation.mockReset();
    mockElicitSelection.mockReset();
    mockElicitText.mockReset();
    mockBuildBackupStatusCard.mockReset();
    mockBuildBackupStatusCard.mockResolvedValue(null);
  });

  describe("credential gating", () => {
    it("returns an error when credsOrErr is null", async () => {
      const result = await handleSpanningTool("spanning_status", {}, null);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No Spanning credentials provided");
      expect(mockUsersList).not.toHaveBeenCalled();
    });

    it("returns the credential error body when credsOrErr carries a status", async () => {
      const credError = { status: 401, body: { error: "Missing credentials", required: ["SPANNING_API_TOKEN"] } };
      const result = await handleSpanningTool("spanning_status", {}, credError);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Missing credentials");
      expect(result.content[0].text).toContain("SPANNING_API_TOKEN");
    });
  });

  describe("spanning_status", () => {
    it("returns status without touching the API client", async () => {
      const result = await handleSpanningTool("spanning_status", {}, CREDS);

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("ok");
      expect(data.platform).toBe("m365");
      expect(data.adminEmail).toBe("admin@acme.example");
      expect(mockUsersList).not.toHaveBeenCalled();
    });
  });

  describe("spanning_list_users", () => {
    it("defaults limit to 100", async () => {
      mockUsersList.mockResolvedValueOnce([{ id: "u1" }]);
      const result = await handleSpanningTool("spanning_list_users", {}, CREDS);

      expect(mockUsersList).toHaveBeenCalledWith({ limit: 100 });
      expect(result.isError).toBeUndefined();
    });

    it("passes an explicit limit through", async () => {
      mockUsersList.mockResolvedValueOnce([]);
      await handleSpanningTool("spanning_list_users", { limit: 25 }, CREDS);

      expect(mockUsersList).toHaveBeenCalledWith({ limit: 25 });
    });

    it("returns an empty array when the API returns nullish", async () => {
      mockUsersList.mockResolvedValueOnce(undefined);
      const result = await handleSpanningTool("spanning_list_users", {}, CREDS);

      expect(JSON.parse(result.content[0].text)).toEqual([]);
    });
  });

  describe("spanning_get_user", () => {
    it("fetches the user by ID", async () => {
      mockUsersGet.mockResolvedValueOnce({ id: "u1", displayName: "Dana" });
      const result = await handleSpanningTool("spanning_get_user", { userId: "u1" }, CREDS);

      expect(mockUsersGet).toHaveBeenCalledWith("u1");
      const data = JSON.parse(result.content[0].text);
      expect(data.displayName).toBe("Dana");
    });

    it("attaches a _card field when buildBackupStatusCard returns one", async () => {
      mockUsersGet.mockResolvedValueOnce({ id: "u1" });
      mockBuildBackupStatusCard.mockResolvedValueOnce({ id: "u1", services: [] });

      const result = await handleSpanningTool("spanning_get_user", { userId: "u1" }, CREDS);

      // buildBackupStatusCard is called with the SAME payload object the
      // handler later mutates to attach _card, so assert on identity/shape
      // rather than a snapshot — a toEqual snapshot would reflect the
      // post-mutation state via reference, not what was passed at call time.
      expect(mockBuildBackupStatusCard).toHaveBeenCalledWith(
        expect.objectContaining({ id: "u1" }),
        "m365",
        mockClient
      );
      const data = JSON.parse(result.content[0].text);
      expect(data._card).toEqual({ id: "u1", services: [] });
    });

    it("omits _card entirely when buildBackupStatusCard returns null", async () => {
      mockUsersGet.mockResolvedValueOnce({ id: "u1" });

      const result = await handleSpanningTool("spanning_get_user", { userId: "u1" }, CREDS);

      const data = JSON.parse(result.content[0].text);
      expect(data._card).toBeUndefined();
    });
  });

  describe("spanning_list_services / spanning_list_backups", () => {
    it("lists services for a user", async () => {
      mockServicesList.mockResolvedValueOnce([{ name: "mail" }]);
      const result = await handleSpanningTool("spanning_list_services", { userId: "u1" }, CREDS);

      expect(mockServicesList).toHaveBeenCalledWith("u1");
      expect(JSON.parse(result.content[0].text)).toEqual([{ name: "mail" }]);
    });

    it("lists backups for a user+service", async () => {
      mockBackupsList.mockResolvedValueOnce([{ id: "b1" }]);
      await handleSpanningTool("spanning_list_backups", { userId: "u1", service: "mail" }, CREDS);

      expect(mockBackupsList).toHaveBeenCalledWith("u1", "mail");
    });
  });

  describe("spanning_queue_restore", () => {
    const args = { userId: "u1", service: "mail", items: ["msg-1", "msg-2"] };

    it("queues the restore when the user confirms", async () => {
      mockElicitConfirmation.mockResolvedValueOnce(true);
      mockRestoresQueue.mockResolvedValueOnce({ restoreId: "r1" });

      const result = await handleSpanningTool("spanning_queue_restore", args, CREDS);

      expect(mockElicitConfirmation).toHaveBeenCalledTimes(1);
      expect(mockRestoresQueue).toHaveBeenCalledWith("u1", "mail", { items: ["msg-1", "msg-2"] });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual({ restoreId: "r1" });
    });

    it("cancels without calling the API when the user declines", async () => {
      mockElicitConfirmation.mockResolvedValueOnce(false);

      const result = await handleSpanningTool("spanning_queue_restore", args, CREDS);

      expect(mockRestoresQueue).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("cancelled by user");
    });

    it("cancels with a distinct message when the client can't elicit at all", async () => {
      mockElicitConfirmation.mockResolvedValueOnce(null);

      const result = await handleSpanningTool("spanning_queue_restore", args, CREDS);

      expect(mockRestoresQueue).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("does not support confirmation prompts");
    });
  });

  describe("spanning_get_restore_status", () => {
    it("fetches restore status by ID", async () => {
      mockRestoresGet.mockResolvedValueOnce({ status: "completed" });
      const result = await handleSpanningTool("spanning_get_restore_status", { restoreId: "r1" }, CREDS);

      expect(mockRestoresGet).toHaveBeenCalledWith("r1");
      expect(JSON.parse(result.content[0].text)).toEqual({ status: "completed" });
    });
  });

  describe("spanning_list_audit_log", () => {
    it("skips elicitation and applies from/to when since/until are explicit", async () => {
      mockAuditList.mockResolvedValueOnce({ items: [] });

      await handleSpanningTool(
        "spanning_list_audit_log",
        { since: "2026-01-01T00:00:00Z", until: "2026-01-31T00:00:00Z" },
        CREDS
      );

      expect(mockElicitSelection).not.toHaveBeenCalled();
      expect(mockAuditList).toHaveBeenCalledWith({
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-31T00:00:00.000Z",
      });
    });

    it("elicits a window and applies it when no range is given", async () => {
      mockElicitSelection.mockResolvedValueOnce("all");
      mockAuditList.mockResolvedValueOnce({ items: [] });

      await handleSpanningTool("spanning_list_audit_log", {}, CREDS);

      expect(mockElicitSelection).toHaveBeenCalledTimes(1);
      expect(mockAuditList).toHaveBeenCalledWith({ from: undefined, to: undefined });
    });

    it("unwraps a bare-array audit response the same as an {items} response", async () => {
      mockElicitSelection.mockResolvedValueOnce("all");
      mockAuditList.mockResolvedValueOnce([{ id: "a1", createdAt: 1700000000000 }]);

      const result = await handleSpanningTool("spanning_list_audit_log", {}, CREDS);

      expect(JSON.parse(result.content[0].text)).toEqual([{ id: "a1", createdAt: 1700000000000 }]);
    });
  });

  describe("spanning_get_license_usage", () => {
    it("fetches license usage", async () => {
      mockLicenseGet.mockResolvedValueOnce({ used: 10, total: 50 });
      const result = await handleSpanningTool("spanning_get_license_usage", {}, CREDS);

      expect(JSON.parse(result.content[0].text)).toEqual({ used: 10, total: 50 });
    });
  });

  describe("unknown tool", () => {
    it("returns an error for an unrecognized tool name", async () => {
      const result = await handleSpanningTool("spanning_bogus", {}, CREDS);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool: spanning_bogus");
    });
  });

  describe("error handling", () => {
    it("maps a NotImplementedError-named error to a platform-specific message", async () => {
      const err = new Error("no license API for this platform");
      err.name = "NotImplementedError";
      mockLicenseGet.mockRejectedValueOnce(err);

      const result = await handleSpanningTool("spanning_get_license_usage", {}, CREDS);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        "Not implemented for platform 'm365': no license API for this platform"
      );
    });

    it("maps a message matching /not implemented/i even without the error name", async () => {
      mockLicenseGet.mockRejectedValueOnce(new Error("license lookup not implemented for salesforce"));

      const result = await handleSpanningTool(
        "spanning_get_license_usage",
        {},
        { ...CREDS, platform: "salesforce" }
      );

      expect(result.content[0].text).toContain("Not implemented for platform 'salesforce'");
    });

    it("wraps any other error generically", async () => {
      mockLicenseGet.mockRejectedValueOnce(new Error("Spanning API 500"));

      const result = await handleSpanningTool("spanning_get_license_usage", {}, CREDS);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: Spanning API 500");
    });
  });
});

describe("filterByDate", () => {
  const items = [
    { id: "a", createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", createdAt: "2026-01-15T00:00:00Z" },
    { id: "c", createdAt: "2026-01-31T00:00:00Z" },
  ];

  it("keeps items with no timestamp field (can't be filtered out)", () => {
    const result = filterByDate([{ id: "no-ts" }], { sinceMs: Date.now() });
    expect(result).toEqual([{ id: "no-ts" }]);
  });

  it("filters to the inclusive [sinceMs, untilMs] window", () => {
    const result = filterByDate(items, {
      sinceMs: new Date("2026-01-10T00:00:00Z").getTime(),
      untilMs: new Date("2026-01-20T00:00:00Z").getTime(),
    });
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });

  it("returns everything when the range is unbounded", () => {
    expect(filterByDate(items, {})).toHaveLength(3);
  });

  it("caps output at the page cap", () => {
    const many = Array.from({ length: 2005 }, (_, i) => ({ id: `x${i}` }));
    expect(filterByDate(many, {})).toHaveLength(2000);
  });
});
