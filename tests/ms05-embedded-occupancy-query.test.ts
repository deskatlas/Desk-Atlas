import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ReservationSupabaseRepository } from "@deskatlas/domain";

/**
 * Tests for occupancy query optimization and structural parity without N+1 query cascades.
 * Traceability: MS-05 / QAD-TC6.3, SDD-C1, ERD-E10, ERD-E11
 */
describe("MS-05 / QAD-TC6.3: Embedded / Batched Occupancy Query Parity", () => {
  const nowIso = "2026-09-23T10:00:00.000Z";

  it("maps confirmed and checked-in reservations to OCCUPIED and RESERVED occupancy records", async () => {
    const requestedUrls: string[] = [];

    const mockReservations = [
      {
        id: "res-occ-1",
        reference_code: "DA-2026-OCC1",
        source: "WEB",
        customer_first_name: "Alice",
        customer_last_name: "Smith",
        customer_email: "alice@example.com",
        status: "CHECKED_IN",
        rate_snapshot: 150,
        amount_due: 300,
        created_at: "2026-09-23T08:00:00.000Z",
        updated_at: "2026-09-23T08:00:00.000Z",
        confirmed_at: "2026-09-23T08:05:00.000Z",
        checked_in_at: "2026-09-23T09:00:00.000Z",
      },
      {
        id: "res-occ-2",
        reference_code: "DA-2026-OCC2",
        source: "KIOSK",
        customer_first_name: "Bob",
        customer_last_name: "Jones",
        customer_email: "bob@example.com",
        status: "CONFIRMED",
        rate_snapshot: 100,
        amount_due: 200,
        created_at: "2026-09-23T08:00:00.000Z",
        updated_at: "2026-09-23T08:00:00.000Z",
        confirmed_at: "2026-09-23T08:10:00.000Z",
      },
    ];

    const mockCandidates = [
      {
        id: "cand-1",
        reservation_id: "res-occ-1",
        workspace_instance_id: "inst-desk-1",
        start_at: "2026-09-23T09:00:00.000Z",
        end_at: "2026-09-23T13:00:00.000Z",
        is_assigned: true,
        rank: 0,
      },
      {
        id: "cand-2",
        reservation_id: "res-occ-2",
        workspace_instance_id: "inst-desk-2",
        start_at: "2026-09-23T09:30:00.000Z",
        end_at: "2026-09-23T11:30:00.000Z",
        is_assigned: true,
        rank: 0,
      },
    ];

    const mockInstances = [
      {
        id: "inst-desk-1",
        template_id: "tpl-hot-desk",
        floor_id: "floor-1",
        instance_code: "HD-01",
        display_name: "Hot Desk 01",
      },
      {
        id: "inst-desk-2",
        template_id: "tpl-dedicated",
        floor_id: "floor-1",
        instance_code: "DD-02",
        display_name: "Dedicated Desk 02",
      },
    ];

    const mockTemplates = [
      {
        id: "tpl-hot-desk",
        name: "Hot Desk",
        capacity: 1,
        rate_amount: 150,
        pricing_unit: "HOURLY",
      },
      {
        id: "tpl-dedicated",
        name: "Dedicated Desk",
        capacity: 1,
        rate_amount: 100,
        pricing_unit: "HOURLY",
      },
    ];

    const mockFloors = [
      {
        id: "floor-1",
        name: "Ground Floor",
        floor_number: 1,
      },
    ];

    const mockFetcher: typeof fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      requestedUrls.push(urlStr);

      if (urlStr.includes("/reservations?")) {
        return new Response(JSON.stringify(mockReservations), { status: 200 });
      }
      if (urlStr.includes("/reservation_candidates?")) {
        return new Response(JSON.stringify(mockCandidates), { status: 200 });
      }
      if (urlStr.includes("/workspace_instances?")) {
        return new Response(JSON.stringify(mockInstances), { status: 200 });
      }
      if (urlStr.includes("/workspace_templates?")) {
        return new Response(JSON.stringify(mockTemplates), { status: 200 });
      }
      if (urlStr.includes("/floors?")) {
        return new Response(JSON.stringify(mockFloors), { status: 200 });
      }
      if (urlStr.includes("/payment_attempts?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (urlStr.includes("/audit_logs?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const repo = new ReservationSupabaseRepository({
      supabaseUrl: "https://test.supabase.co",
      serviceRoleKey: "test-service-key",
      fetcher: mockFetcher,
    });

    const records = await repo.listOccupancy(nowIso);

    assert.strictEqual(records.length, 2, "Both active sessions should be returned");

    const checkedInRecord = records.find((r) => r.reservationId === "res-occ-1");
    assert.ok(checkedInRecord);
    assert.strictEqual(checkedInRecord.occupancyState, "OCCUPIED");
    assert.strictEqual(checkedInRecord.workspaceDisplayName, "Hot Desk 01");
    assert.strictEqual(checkedInRecord.workspaceInstanceCode, "HD-01");

    const reservedRecord = records.find((r) => r.reservationId === "res-occ-2");
    assert.ok(reservedRecord);
    assert.strictEqual(reservedRecord.occupancyState, "RESERVED");
    assert.strictEqual(reservedRecord.workspaceDisplayName, "Dedicated Desk 02");
    assert.strictEqual(reservedRecord.workspaceInstanceCode, "DD-02");
  });

  it("eliminates N+1 query roundtrips by batching candidate lookups with reservation_id=in.(...)", async () => {
    const requestedUrls: string[] = [];

    const mockReservations = Array.from({ length: 10 }, (_, i) => ({
      id: `res-batch-${i + 1}`,
      reference_code: `DA-BATCH-${i + 1}`,
      source: "WEB",
      customer_first_name: `User${i + 1}`,
      customer_last_name: "Test",
      customer_email: `user${i + 1}@example.com`,
      status: "CHECKED_IN",
      rate_snapshot: 100,
      amount_due: 200,
      created_at: "2026-09-23T08:00:00.000Z",
      updated_at: "2026-09-23T08:00:00.000Z",
      checked_in_at: "2026-09-23T09:00:00.000Z",
    }));

    const mockCandidates = mockReservations.map((r, i) => ({
      id: `cand-batch-${i + 1}`,
      reservation_id: r.id,
      workspace_instance_id: `inst-${i + 1}`,
      start_at: "2026-09-23T09:00:00.000Z",
      end_at: "2026-09-23T17:00:00.000Z",
      is_assigned: true,
      rank: 0,
    }));

    const mockFetcher: typeof fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      requestedUrls.push(urlStr);

      if (urlStr.includes("/reservations?")) {
        return new Response(JSON.stringify(mockReservations), { status: 200 });
      }
      if (urlStr.includes("/reservation_candidates?")) {
        return new Response(JSON.stringify(mockCandidates), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const repo = new ReservationSupabaseRepository({
      supabaseUrl: "https://test.supabase.co",
      serviceRoleKey: "test-service-key",
      fetcher: mockFetcher,
    });

    await repo.listOccupancy(nowIso);

    // Verify candidate queries are batched rather than 1 per reservation
    const candidateCalls = requestedUrls.filter((u) => u.includes("/reservation_candidates?"));
    assert.ok(
      candidateCalls.length <= 2,
      `Expected at most 2 batched candidate calls for 10 reservations, but got ${candidateCalls.length}`
    );
    assert.ok(
      candidateCalls[0].includes("reservation_id=in."),
      "Candidate query must use batch in.(...) filtering"
    );
  });

  it("filters out reservations that have already concluded before nowIso", async () => {
    const mockReservations = [
      {
        id: "res-past",
        reference_code: "DA-PAST",
        source: "WEB",
        customer_first_name: "Past",
        customer_last_name: "Customer",
        customer_email: "past@example.com",
        status: "CONFIRMED",
        rate_snapshot: 100,
        amount_due: 200,
        created_at: "2026-09-23T06:00:00.000Z",
        updated_at: "2026-09-23T06:00:00.000Z",
      },
    ];

    const mockCandidates = [
      {
        id: "cand-past",
        reservation_id: "res-past",
        workspace_instance_id: "inst-desk-past",
        start_at: "2026-09-23T07:00:00.000Z",
        end_at: "2026-09-23T09:00:00.000Z", // Ended before nowIso (10:00:00)
        is_assigned: true,
        rank: 0,
      },
    ];

    const mockFetcher: typeof fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("/reservations?")) {
        return new Response(JSON.stringify(mockReservations), { status: 200 });
      }
      if (urlStr.includes("/reservation_candidates?")) {
        return new Response(JSON.stringify(mockCandidates), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const repo = new ReservationSupabaseRepository({
      supabaseUrl: "https://test.supabase.co",
      serviceRoleKey: "test-service-key",
      fetcher: mockFetcher,
    });

    const records = await repo.listOccupancy(nowIso);
    assert.strictEqual(records.length, 0, "Past booking must not appear in current occupancy");
  });
});
