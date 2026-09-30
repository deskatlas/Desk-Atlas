import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import {
  SupabasePublishedMapRepository,
  createPublishedMapService,
  buildReservationTrackingUrl,
  renderClosureManualResolutionEmail,
  renderClosureOutreachEmail,
  renderClosureImpactNoticeEmail,
  renderBookingConfirmationEmail,
} from "@deskatlas/domain";

/**
 * Tests for MS-25: Multi-Application 4-Map Deployed Propagation Parity,
 * Canvas Dimension Modal Dismissal, and Manual Resolution Production Email Tracking URL.
 * Traceability: MS-25, BRD-M2, BRD-M4, PRD-F5, PRD-F8, PRD-F9, PRD-F10, PRD-F15, QAD-TC25
 */
describe("MS-25: 4-Map Deployed Propagation Parity, Canvas Modal Dismissal, and Production Email URL", () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalPublicAppUrl = process.env.DESKATLAS_PUBLIC_APP_URL;
  const originalCustomerUrl = process.env.NEXT_PUBLIC_CUSTOMER_URL;

  function setupEnv() {
    process.env.SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
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
    if (originalPublicAppUrl !== undefined) {
      process.env.DESKATLAS_PUBLIC_APP_URL = originalPublicAppUrl;
    } else {
      delete process.env.DESKATLAS_PUBLIC_APP_URL;
    }
    if (originalCustomerUrl !== undefined) {
      process.env.NEXT_PUBLIC_CUSTOMER_URL = originalCustomerUrl;
    } else {
      delete process.env.NEXT_PUBLIC_CUSTOMER_URL;
    }
  }

  // QAD-TC25.1 & QAD-TC25.2: Canvas Dimension Modal Dismissal
  it("QAD-TC25.1 & QAD-TC25.2: MapEditor source invokes setShowCanvasSizeModal(false) on preset and custom size application", () => {
    const mapEditorPath = path.resolve(
      __dirname,
      "../apps/admin-portal/src/features/map-builder/components/MapEditor.tsx"
    );
    const content = fs.readFileSync(mapEditorPath, "utf-8");

    // Check presets dismiss modal
    assert.match(
      content,
      /applyCanvasDimensions\(preset\.width,\s*preset\.height\);[\s\S]*?setShowCanvasSizeModal\(false\);/,
      "MapEditor preset selection must close canvas size modal"
    );

    // Check custom size apply dismisses modal
    assert.match(
      content,
      /applyCanvasDimensions\(w,\s*h\);[\s\S]*?setShowCanvasSizeModal\(false\);/,
      "MapEditor custom size apply button must close canvas size modal"
    );
  });

  // QAD-TC25.3: Manual Resolution Email URL Production Resolution
  it("QAD-TC25.3: Manual resolution and closure outreach email renderers resolve public tracking URLs without localhost:3001", () => {
    process.env.DESKATLAS_PUBLIC_APP_URL = "https://app.deskatlas.com";

    // 1. Closure Manual Resolution Email
    const manualResult = renderClosureManualResolutionEmail({
      to: "guest@example.com",
      customerFirstName: "Jane",
      customerLastName: "Doe",
      referenceCode: "REF-MANUAL-123",
      closureDate: "2026-10-15",
      closureReason: "Emergency Maintenance",
    });

    assert.ok(
      manualResult.text.includes("https://app.deskatlas.com/track?code=REF-MANUAL-123&remedy=closure"),
      "Manual resolution text email must include production tracking URL"
    );
    assert.ok(
      manualResult.html.includes("https://app.deskatlas.com/track?code=REF-MANUAL-123"),
      "Manual resolution HTML email must include production tracking URL"
    );
    assert.ok(
      !manualResult.html.includes("localhost:3001"),
      "Manual resolution HTML email must not contain hardcoded localhost:3001"
    );
    assert.ok(
      !manualResult.text.includes("localhost:3001"),
      "Manual resolution text email must not contain hardcoded localhost:3001"
    );

    // 2. Closure Outreach Email
    const outreachResult = renderClosureOutreachEmail({
      to: "guest@example.com",
      customerFirstName: "Jane",
      customerLastName: "Doe",
      referenceCode: "REF-OUTREACH-456",
      closureDate: "2026-10-15",
      closureReason: "Renovation",
    });

    assert.ok(
      outreachResult.text.includes("https://app.deskatlas.com/track?code=REF-OUTREACH-456&remedy=closure"),
      "Closure outreach text email must include production tracking URL"
    );
    assert.ok(
      outreachResult.html.includes("https://app.deskatlas.com/track?code=REF-OUTREACH-456"),
      "Closure outreach HTML email must include production tracking URL"
    );
    assert.ok(
      !outreachResult.html.includes("localhost:3001"),
      "Closure outreach HTML email must not contain hardcoded localhost:3001"
    );

    // 3. Facility Closure Notice Email
    const noticeResult = renderClosureImpactNoticeEmail({
      to: "guest@example.com",
      customerName: "Jane Doe",
      customerFirstName: "Jane",
      customerLastName: "Doe",
      referenceCode: "REF-NOTICE-789",
      closureDate: "2026-10-15",
      closureReason: "Holiday",
    });

    assert.ok(
      noticeResult.text.includes("https://app.deskatlas.com/track?code=REF-NOTICE-789&remedy=closure"),
      "Facility closure notice text email must include production tracking URL"
    );
    assert.ok(
      noticeResult.html.includes("https://app.deskatlas.com/track?code=REF-NOTICE-789"),
      "Facility closure notice HTML email must include production tracking URL"
    );
    assert.ok(
      !noticeResult.html.includes("localhost:3001"),
      "Facility closure notice HTML email must not contain hardcoded localhost:3001"
    );
  });

  // QAD-TC25.4: Published Map Query Ordering
  it("QAD-TC25.4: SupabasePublishedMapRepository queries map_versions with order=version_number.desc", async () => {
    setupEnv();
    const queriedUrls: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      queriedUrls.push(urlStr);

      if (urlStr.includes("/map_versions")) {
        return new Response(
          JSON.stringify([
            {
              id: "ver-2",
              floor_id: "fl-1",
              version_number: 2,
              canvas_width: 1600,
              canvas_height: 1000,
              grid_size: 40,
              published_at: "2026-09-30T10:00:00Z",
              compiled_map_cache: {
                floor: {
                  id: "fl-1",
                  name: "Main Floor",
                  floorNumber: 1,
                  displayOrder: 1,
                  isActive: true,
                },
                version: {
                  id: "ver-2",
                  versionNumber: 2,
                  canvasWidth: 1600,
                  canvasHeight: 1000,
                  gridSize: 40,
                  publishedAt: "2026-09-30T10:00:00Z",
                },
                elements: [],
              },
            },
            {
              id: "ver-1",
              floor_id: "fl-1",
              version_number: 1,
              canvas_width: 1200,
              canvas_height: 800,
              grid_size: 40,
              published_at: "2026-09-29T10:00:00Z",
              compiled_map_cache: null,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes("/floors")) {
        return new Response(
          JSON.stringify([
            {
              id: "fl-1",
              name: "Main Floor",
              floor_number: 1,
              display_order: 1,
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

    try {
      const repo = new SupabasePublishedMapRepository();
      const service = createPublishedMapService(repo);

      // Test loadPublishedFloorMap
      await service.loadPublishedFloorMap("fl-1");
      const loadMapQuery = queriedUrls.find((u) => u.includes("/map_versions") && u.includes("floor_id=eq.fl-1"));
      assert.ok(loadMapQuery, "loadPublishedFloorMap must query map_versions");
      assert.ok(
        loadMapQuery.includes("order=version_number.desc"),
        "loadPublishedFloorMap query must include order=version_number.desc"
      );

      // Test loadAllPublishedFloorMaps
      queriedUrls.length = 0;
      await service.loadAllPublishedFloorMaps();
      const loadAllQuery = queriedUrls.find((u) => u.includes("/map_versions"));
      assert.ok(loadAllQuery, "loadAllPublishedFloorMaps must query map_versions");
      assert.ok(
        loadAllQuery.includes("order=version_number.desc"),
        "loadAllPublishedFloorMaps query must include order=version_number.desc"
      );
    } finally {
      teardownEnv();
    }
  });

  // QAD-TC25.5: Edge Cache Control Headers
  it("QAD-TC25.5: Customer and Kiosk return s-maxage=30, Staff and Admin return private no-store headers", async () => {
    setupEnv();
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes("/map_versions")) {
        return new Response(
          JSON.stringify([
            {
              floor_id: "fl-1",
              compiled_map_cache: {
                floor: { id: "fl-1", name: "Main Floor", floorNumber: 1, displayOrder: 1, isActive: true },
                version: { id: "ver-1", versionNumber: 1, canvasWidth: 1600, canvasHeight: 1000, gridSize: 40, publishedAt: "2026-09-30T10:00:00Z" },
                elements: [],
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("/floors")) {
        return new Response(
          JSON.stringify([
            { id: "fl-1", name: "Main Floor", floor_number: 1, display_order: 1, is_active: true },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    function createMockRequest(url: string) {
      const parsedUrl = new URL(url);
      return {
        url,
        nextUrl: parsedUrl,
      } as unknown as Parameters<typeof import("../apps/customer-website/src/app/api/published-map/route").GET>[0];
    }

    try {
      // 1. Customer Website Route
      const customerModule = await import("../apps/customer-website/src/app/api/published-map/route");
      const customerRes = await customerModule.GET(createMockRequest("http://localhost:3001/api/published-map"));
      const customerCache = customerRes.headers.get("Cache-Control");
      const customerCdnCache = customerRes.headers.get("CDN-Cache-Control");

      assert.ok(customerCache, "Customer /api/published-map must set Cache-Control");
      assert.match(customerCache, /s-maxage=30/, "Customer Cache-Control must have s-maxage=30");
      assert.match(customerCache, /stale-while-revalidate=60/, "Customer Cache-Control must have stale-while-revalidate=60");
      assert.ok(customerCdnCache, "Customer /api/published-map must set CDN-Cache-Control");
      assert.match(customerCdnCache, /s-maxage=30/, "Customer CDN-Cache-Control must have s-maxage=30");

      // 2. Kiosk Route
      const kioskModule = await import("../apps/kiosk/src/app/api/published-map/route");
      const kioskRes = await kioskModule.GET(createMockRequest("http://localhost:3002/api/published-map"));
      const kioskCache = kioskRes.headers.get("Cache-Control");
      const kioskCdnCache = kioskRes.headers.get("CDN-Cache-Control");

      assert.ok(kioskCache, "Kiosk /api/published-map must set Cache-Control");
      assert.match(kioskCache, /s-maxage=30/, "Kiosk Cache-Control must have s-maxage=30");
      assert.ok(kioskCdnCache, "Kiosk /api/published-map must set CDN-Cache-Control");
      assert.match(kioskCdnCache, /s-maxage=30/, "Kiosk CDN-Cache-Control must have s-maxage=30");

      // 3. Staff Dashboard Route
      const staffModule = await import("../apps/staff-dashboard/src/app/api/published-map/route");
      const staffRes = await staffModule.GET(createMockRequest("http://localhost:3003/api/published-map"));
      const staffCache = staffRes.headers.get("Cache-Control");

      assert.ok(staffCache, "Staff /api/published-map must set Cache-Control");
      assert.match(staffCache, /no-store/, "Staff Cache-Control must be no-store");
      assert.match(staffCache, /no-cache/, "Staff Cache-Control must be no-cache");

      // 4. Admin Portal Route
      const adminModule = await import("../apps/admin-portal/src/app/api/published-map/route");
      const adminRes = await adminModule.GET(createMockRequest("http://localhost:3000/api/published-map"));
      const adminCache = adminRes.headers.get("Cache-Control");

      assert.ok(adminCache, "Admin /api/published-map must set Cache-Control");
      assert.match(adminCache, /no-store/, "Admin Cache-Control must be no-store");
      assert.match(adminCache, /no-cache/, "Admin Cache-Control must be no-cache");
    } finally {
      teardownEnv();
    }
  });

  // QAD-TC25.6: Four-Map Operational Status Reflection
  it("QAD-TC25.6: Workspace operational status is hydrated live from database upon loading published floor map", async () => {
    setupEnv();
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes("/map_versions")) {
        return new Response(
          JSON.stringify([
            {
              floor_id: "fl-1",
              compiled_map_cache: {
                floor: { id: "fl-1", name: "Main Floor", floorNumber: 1, displayOrder: 1, isActive: true },
                version: { id: "ver-1", versionNumber: 1, canvasWidth: 1600, canvasHeight: 1000, gridSize: 40, publishedAt: "2026-09-30T10:00:00Z" },
                elements: [
                  {
                    id: "elem-1",
                    elementRole: "WORKSPACE",
                    elementType: "WORKSPACE",
                    x: 100,
                    y: 100,
                    width: 80,
                    height: 80,
                    rotation: 0,
                    zIndex: 1,
                    workspace: {
                      workspaceInstanceId: "inst-1",
                      templateId: "tpl-1",
                      instanceCode: "POD-01",
                      displayName: "Focus Pod 1",
                      operationalStatus: "ACTIVE",
                      maintenanceNote: null,
                    },
                  },
                ],
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes("/workspace_instances")) {
        return new Response(
          JSON.stringify([
            {
              id: "inst-1",
              operational_status: "MAINTENANCE",
              maintenance_note: "Power socket repair",
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
              name: "Focus Pod",
              rate_amount: 150,
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

    try {
      const repo = new SupabasePublishedMapRepository();
      const service = createPublishedMapService(repo);

      const map = await service.loadPublishedFloorMap("fl-1", { audience: "STAFF" });
      assert.ok(map, "Published floor map must be returned");
      assert.equal(map.elements.length, 1);
      assert.equal(
        map.elements[0].workspace?.operationalStatus,
        "MAINTENANCE",
        "Operational status must be hydrated to MAINTENANCE from live workspace_instances table"
      );
      assert.equal(
        map.elements[0].workspace?.maintenanceNote,
        "Power socket repair",
        "Maintenance note must be hydrated from live workspace_instances table"
      );
    } finally {
      teardownEnv();
    }
  });
});
