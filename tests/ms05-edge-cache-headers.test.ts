import assert from "node:assert/strict";
import { describe, it } from "vitest";

/**
 * Tests for Edge Cache-Control headers across read-heavy endpoints.
 * Traceability: MS-05 / QAD-TC6.4, BRD-M4
 */
describe("MS-05 / QAD-TC6.4: Edge Cache Headers Enforcement", () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  function setupEnv() {
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes("/workspace_instances")) {
        return new Response(
          JSON.stringify([
            {
              id: "inst-1",
              template_id: "tpl-1",
              floor_id: "fl-1",
              instance_code: "D-1",
              display_name: "Desk 1",
              operational_status: "ACTIVE",
              template: {
                id: "tpl-1",
                name: "Hot Desk",
                description: null,
                photo_path: null,
                capacity: 1,
                rate_amount: 100,
                pricing_unit: "HOURLY",
                default_shape: "desk",
                default_color: "#009689",
                default_style: "standard",
                is_active: true,
              },
              floor: {
                id: "fl-1",
                name: "Ground Floor",
                floor_number: 1,
                display_order: 1,
                is_active: true,
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("/workspace_templates")) {
        return new Response(
          JSON.stringify([
            {
              id: "tpl-1",
              name: "Hot Desk",
              capacity: 1,
              rate_amount: 100,
              pricing_unit: "HOURLY",
              is_active: true,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("/business_settings") || urlStr.includes("/settings")) {
        return new Response(
          JSON.stringify([
            {
              business_hours_open: "08:00",
              business_hours_close: "20:00",
              booking_interval_minutes: 30,
              timezone: "Asia/Manila",
              operating_days: [
                "MONDAY",
                "TUESDAY",
                "WEDNESDAY",
                "THURSDAY",
                "FRIDAY",
                "SATURDAY",
                "SUNDAY",
              ],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("/operating_hours")) {
        return new Response(
          JSON.stringify([
            {
              id: "op-1",
              day_of_week: 3,
              opens_at: "08:00",
              closes_at: "20:00",
              is_active: true,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
  }

  function teardownEnv() {
    globalThis.fetch = originalFetch;
    if (originalUrl !== undefined) {
      process.env.SUPABASE_URL = originalUrl;
    } else {
      delete process.env.SUPABASE_URL;
    }
    if (originalKey !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  }

  function createMockRequest(url: string) {
    const parsedUrl = new URL(url);
    return {
      url,
      nextUrl: parsedUrl,
    } as unknown as Parameters<typeof import("../apps/kiosk/src/app/api/availability/route").GET>[0];
  }

  it("enforces Cache-Control: public, s-maxage=5, stale-while-revalidate=15 on admin occupancy route", async () => {
    setupEnv();
    try {
      const { GET } = await import(
        "../apps/admin-portal/src/app/api/admin/occupancy/route"
      );
      const res = await GET();
      const header = res.headers.get("Cache-Control");

      assert.ok(header, "Cache-Control header must be set on /api/admin/occupancy");
      assert.match(header, /public/i);
      assert.match(header, /s-maxage=5/);
      assert.match(header, /stale-while-revalidate=15/);
    } finally {
      teardownEnv();
    }
  });

  it("enforces Cache-Control: public, s-maxage=5, stale-while-revalidate=15 on staff occupancy route", async () => {
    setupEnv();
    try {
      const { GET } = await import(
        "../apps/staff-dashboard/src/app/api/operations/occupancy/route"
      );
      const res = await GET();
      const header = res.headers.get("Cache-Control");

      assert.ok(header, "Cache-Control header must be set on /api/operations/occupancy");
      assert.match(header, /public/i);
      assert.match(header, /s-maxage=5/);
      assert.match(header, /stale-while-revalidate=15/);
    } finally {
      teardownEnv();
    }
  });

  it("enforces Cache-Control: public, s-maxage=10, stale-while-revalidate=30 on kiosk availability route", async () => {
    setupEnv();
    try {
      const { GET } = await import(
        "../apps/kiosk/src/app/api/availability/route"
      );
      const req = createMockRequest(
        "http://localhost:3002/api/availability?occupiedNow=true"
      );
      const res = await GET(req);
      const header = res.headers.get("Cache-Control");

      assert.ok(header, "Cache-Control header must be set on kiosk /api/availability");
      assert.match(header, /public/i);
      assert.match(header, /s-maxage=10/);
      assert.match(header, /stale-while-revalidate=30/);
    } finally {
      teardownEnv();
    }
  });

  it("enforces Cache-Control: public, s-maxage=10, stale-while-revalidate=30 on customer availability route", async () => {
    setupEnv();
    try {
      const { GET } = await import(
        "../apps/customer-website/src/app/api/availability/route"
      );
      const req = createMockRequest(
        "http://localhost:3001/api/availability?templateId=tpl-1&date=2026-09-23&durationMinutes=60"
      );
      const res = await GET(req);
      const header = res.headers.get("Cache-Control");

      assert.ok(header, "Cache-Control header must be set on customer /api/availability");
      assert.match(header, /public/i);
      assert.match(header, /s-maxage=10/);
      assert.match(header, /stale-while-revalidate=30/);
    } finally {
      teardownEnv();
    }
  });

  it("enforces Cache-Control: private, s-maxage=10, stale-while-revalidate=20 on admin badge counts route", async () => {
    setupEnv();
    try {
      const { GET } = await import(
        "../apps/admin-portal/src/app/api/admin/badge-counts/route"
      );
      const res = await GET();
      const header = res.headers.get("Cache-Control");

      assert.ok(header, "Cache-Control header must be set on /api/admin/badge-counts");
      assert.match(header, /private/i);
      assert.match(header, /s-maxage=10/);
      assert.match(header, /stale-while-revalidate=20/);
    } finally {
      teardownEnv();
    }
  });
});
