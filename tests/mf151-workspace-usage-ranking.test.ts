import { describe, it, expect } from "vitest";
import {
  WorkspaceUsageService,
  WorkspaceUsageMemoryRepository,
  WorkspaceUsageSupabaseRepository,
  sortWorkspaceUsageRecords,
  type MemoryWorkspaceTemplate,
  type MemoryWorkspaceInstance,
  type MemoryReservation,
  type MemoryReservationCandidate,
} from "@deskatlas/domain";

describe("MF-151: Admin Dashboard Workspace Usage Top-5 / See All View", () => {
  const templates: MemoryWorkspaceTemplate[] = [
    {
      id: "tpl-1",
      name: "Dedicated Desk",
      rateAmount: 50,
      pricingUnit: "HOURLY",
    },
    {
      id: "tpl-2",
      name: "Private Office",
      rateAmount: 150,
      pricingUnit: "HOURLY",
    },
    {
      id: "tpl-3",
      name: "Meeting Room",
      rateAmount: 300,
      pricingUnit: "HOURLY",
    },
  ];

  const instances: MemoryWorkspaceInstance[] = [
    { id: "inst-1", templateId: "tpl-1", displayName: "Desk A-01", instanceCode: "A-01" },
    { id: "inst-2", templateId: "tpl-1", displayName: "Desk A-02", instanceCode: "A-02" },
    { id: "inst-3", templateId: "tpl-1", displayName: "Desk A-03", instanceCode: "A-03" },
    { id: "inst-4", templateId: "tpl-2", displayName: "Office 101", instanceCode: "OFF-101" },
    { id: "inst-5", templateId: "tpl-2", displayName: "Office 102", instanceCode: "OFF-102" },
    { id: "inst-6", templateId: "tpl-3", displayName: "Meeting Room A", instanceCode: "MR-A" },
    { id: "inst-7", templateId: "tpl-3", displayName: "Meeting Room B", instanceCode: "MR-B" },
  ];

  const candidates: MemoryReservationCandidate[] = [
    // inst-1: 3 bookings (total 5 hours)
    {
      reservationId: "res-1",
      workspaceInstanceId: "inst-1",
      startAt: "2026-09-15T09:00:00Z",
      endAt: "2026-09-15T11:00:00Z", // 2 hrs
      isAssigned: true,
    },
    {
      reservationId: "res-2",
      workspaceInstanceId: "inst-1",
      startAt: "2026-09-16T10:00:00Z",
      endAt: "2026-09-16T12:00:00Z", // 2 hrs
      isAssigned: true,
    },
    {
      reservationId: "res-3",
      workspaceInstanceId: "inst-1",
      startAt: "2026-09-17T13:00:00Z",
      endAt: "2026-09-17T14:00:00Z", // 1 hr
      isAssigned: true,
    },

    // inst-4: 5 bookings (total 10 hours) -> Rank #1
    {
      reservationId: "res-4",
      workspaceInstanceId: "inst-4",
      startAt: "2026-09-15T09:00:00Z",
      endAt: "2026-09-15T11:00:00Z", // 2 hrs
      isAssigned: true,
    },
    {
      reservationId: "res-5",
      workspaceInstanceId: "inst-4",
      startAt: "2026-09-16T09:00:00Z",
      endAt: "2026-09-16T11:00:00Z", // 2 hrs
      isAssigned: true,
    },
    {
      reservationId: "res-6",
      workspaceInstanceId: "inst-4",
      startAt: "2026-09-17T09:00:00Z",
      endAt: "2026-09-17T11:00:00Z", // 2 hrs
      isAssigned: true,
    },
    {
      reservationId: "res-7",
      workspaceInstanceId: "inst-4",
      startAt: "2026-09-18T09:00:00Z",
      endAt: "2026-09-18T11:00:00Z", // 2 hrs
      isAssigned: true,
    },
    {
      reservationId: "res-8",
      workspaceInstanceId: "inst-4",
      startAt: "2026-09-19T09:00:00Z",
      endAt: "2026-09-19T11:00:00Z", // 2 hrs
      isAssigned: true,
    },

    // inst-6: 2 bookings (total 6 hours)
    {
      reservationId: "res-9",
      workspaceInstanceId: "inst-6",
      startAt: "2026-09-15T14:00:00Z",
      endAt: "2026-09-15T17:00:00Z", // 3 hrs
      isAssigned: true,
    },
    {
      reservationId: "res-10",
      workspaceInstanceId: "inst-6",
      startAt: "2026-09-18T14:00:00Z",
      endAt: "2026-09-18T17:00:00Z", // 3 hrs
      isAssigned: true,
    },

    // inst-2: 1 booking (1 hour)
    {
      reservationId: "res-11",
      workspaceInstanceId: "inst-2",
      startAt: "2026-09-19T10:00:00Z",
      endAt: "2026-09-19T11:00:00Z", // 1 hr
      isAssigned: true,
    },

    // cancelled / unconfirmed reservations that should not count
    {
      reservationId: "res-cancelled",
      workspaceInstanceId: "inst-3",
      startAt: "2026-09-19T10:00:00Z",
      endAt: "2026-09-19T14:00:00Z",
      isAssigned: true,
    },
    {
      reservationId: "res-pending",
      workspaceInstanceId: "inst-7",
      startAt: "2026-09-19T10:00:00Z",
      endAt: "2026-09-19T14:00:00Z",
      isAssigned: true,
    },
  ];

  const reservations: MemoryReservation[] = [
    { id: "res-1", status: "CONFIRMED", createdAt: "2026-09-15T08:00:00Z" },
    { id: "res-2", status: "CHECKED_IN", createdAt: "2026-09-16T08:00:00Z" },
    { id: "res-3", status: "COMPLETED", createdAt: "2026-09-17T08:00:00Z" },
    { id: "res-4", status: "CHECKED_OUT", createdAt: "2026-09-15T08:00:00Z" },
    { id: "res-5", status: "CONFIRMED", createdAt: "2026-09-16T08:00:00Z" },
    { id: "res-6", status: "CONFIRMED", createdAt: "2026-09-17T08:00:00Z" },
    { id: "res-7", status: "CONFIRMED", createdAt: "2026-09-18T08:00:00Z" },
    { id: "res-8", status: "CONFIRMED", createdAt: "2026-09-19T08:00:00Z" },
    { id: "res-9", status: "CONFIRMED", createdAt: "2026-09-15T08:00:00Z" },
    { id: "res-10", status: "CONFIRMED", createdAt: "2026-09-18T08:00:00Z" },
    { id: "res-11", status: "CONFIRMED", createdAt: "2026-09-19T08:00:00Z" },
    { id: "res-cancelled", status: "CANCELLED", createdAt: "2026-09-19T08:00:00Z" },
    { id: "res-pending", status: "PENDING_PAYMENT", createdAt: "2026-09-19T08:00:00Z" },
  ];

  it("ranks workspace with most bookings as #1", async () => {
    const memoryRepo = new WorkspaceUsageMemoryRepository({
      templates,
      instances,
      reservations,
      candidates,
    });
    const service = new WorkspaceUsageService(memoryRepo);

    const ranking = await service.getWorkspaceUsageRanking({ limit: "all" });

    expect(ranking.length).toBe(7);
    expect(ranking[0].instanceId).toBe("inst-4");
    expect(ranking[0].instanceName).toBe("Office 101");
    expect(ranking[0].templateName).toBe("Private Office");
    expect(ranking[0].templateTier).toBe("₱150/hr");
    expect(ranking[0].totalBookings).toBe(5);
    expect(ranking[0].totalHoursBooked).toBe(10);

    expect(ranking[1].instanceId).toBe("inst-1");
    expect(ranking[1].totalBookings).toBe(3);
    expect(ranking[1].totalHoursBooked).toBe(5);

    expect(ranking[2].instanceId).toBe("inst-6");
    expect(ranking[2].totalBookings).toBe(2);
    expect(ranking[2].totalHoursBooked).toBe(6);
  });

  it("includes workspaces with zero bookings at the bottom with 0 count", async () => {
    const memoryRepo = new WorkspaceUsageMemoryRepository({
      templates,
      instances,
      reservations,
      candidates,
    });
    const service = new WorkspaceUsageService(memoryRepo);

    const ranking = await service.getWorkspaceUsageRanking({ limit: "all" });

    const zeroBookings = ranking.filter((r) => r.totalBookings === 0);
    expect(zeroBookings.length).toBe(3); // inst-3, inst-5, inst-7
    for (const zb of zeroBookings) {
      expect(zb.totalBookings).toBe(0);
      expect(zb.totalHoursBooked).toBe(0);
      expect(zb.lastBookedAt).toBeNull();
    }
  });

  it("limit=5 returns at most 5 records", async () => {
    const memoryRepo = new WorkspaceUsageMemoryRepository({
      templates,
      instances,
      reservations,
      candidates,
    });
    const service = new WorkspaceUsageService(memoryRepo);

    const top5 = await service.getWorkspaceUsageRanking({ limit: 5 });

    expect(top5.length).toBe(5);
    expect(top5[0].instanceId).toBe("inst-4");
    expect(top5[1].instanceId).toBe("inst-1");
  });

  it("limit=all returns all instances", async () => {
    const memoryRepo = new WorkspaceUsageMemoryRepository({
      templates,
      instances,
      reservations,
      candidates,
    });
    const service = new WorkspaceUsageService(memoryRepo);

    const all = await service.getWorkspaceUsageRanking({ limit: "all" });

    expect(all.length).toBe(instances.length);
  });

  it("date range filter correctly scopes query", async () => {
    const memoryRepo = new WorkspaceUsageMemoryRepository({
      templates,
      instances,
      reservations,
      candidates,
    });
    const service = new WorkspaceUsageService(memoryRepo);

    // Only bookings on 2026-09-18
    const dateFiltered = await service.getWorkspaceUsageRanking({
      dateRange: {
        from: "2026-09-18T00:00:00Z",
        to: "2026-09-18T23:59:59Z",
      },
      limit: "all",
    });

    const inst4 = dateFiltered.find((r) => r.instanceId === "inst-4");
    expect(inst4?.totalBookings).toBe(1);
    expect(inst4?.totalHoursBooked).toBe(2);

    const inst6 = dateFiltered.find((r) => r.instanceId === "inst-6");
    expect(inst6?.totalBookings).toBe(1);
    expect(inst6?.totalHoursBooked).toBe(3);

    const inst1 = dateFiltered.find((r) => r.instanceId === "inst-1");
    expect(inst1?.totalBookings).toBe(0);
  });

  it("sortWorkspaceUsageRecords sorts correctly by bookings, hours, lastBooked, and name", async () => {
    const records = [
      {
        instanceId: "1",
        instanceName: "Z Desk",
        templateName: "Desk",
        templateTier: "₱50/hr",
        totalBookings: 2,
        totalHoursBooked: 10,
        lastBookedAt: "2026-09-10T00:00:00Z",
      },
      {
        instanceId: "2",
        instanceName: "A Desk",
        templateName: "Desk",
        templateTier: "₱50/hr",
        totalBookings: 5,
        totalHoursBooked: 5,
        lastBookedAt: "2026-09-20T00:00:00Z",
      },
    ];

    const sortedByHours = sortWorkspaceUsageRecords(records, "hours", "desc");
    expect(sortedByHours[0].instanceId).toBe("1");

    const sortedByLastBooked = sortWorkspaceUsageRecords(records, "lastBooked", "desc");
    expect(sortedByLastBooked[0].instanceId).toBe("2");

    const sortedByName = sortWorkspaceUsageRecords(records, "name", "asc");
    expect(sortedByName[0].instanceName).toBe("A Desk");
  });

  it("WorkspaceUsageSupabaseRepository queries correct tables and fields without invalid columns", async () => {
    const requestedUrls: string[] = [];
    const originalFetch = global.fetch;

    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes("/workspace_templates")) {
        return new Response(
          JSON.stringify([
            { id: "tpl-1", name: "Dedicated Desk", rate_amount: "50.00", pricing_unit: "HOURLY" },
          ]),
          { status: 200 }
        );
      }
      if (url.includes("/workspace_instances")) {
        return new Response(
          JSON.stringify([
            { id: "inst-1", template_id: "tpl-1", display_name: "Desk 1", instance_code: "D1" },
          ]),
          { status: 200 }
        );
      }
      if (url.includes("/reservation_candidates")) {
        return new Response(
          JSON.stringify([
            {
              reservation_id: "res-1",
              workspace_instance_id: "inst-1",
              start_at: "2026-09-20T08:00:00Z",
              end_at: "2026-09-20T10:00:00Z",
              is_assigned: true,
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes("/reservations")) {
        return new Response(
          JSON.stringify([
            {
              id: "res-1",
              status: "CONFIRMED",
              created_at: "2026-09-20T07:00:00Z",
            },
          ]),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify([]), { status: 200 });
    };

    try {
      const repo = new WorkspaceUsageSupabaseRepository({
        supabaseUrl: "https://test.supabase.co",
        serviceRoleKey: "test-service-role-key",
      });

      const records = await repo.getWorkspaceUsageRecords();

      // Ensure reservations query does NOT ask for non-existent allocated_workspace_instance_id
      const resUrl = requestedUrls.find((u) => u.includes("/reservations?"));
      expect(resUrl).toBeDefined();
      expect(resUrl).not.toContain("allocated_workspace_instance_id");
      expect(resUrl).toContain("select=id,status,created_at");

      expect(records.length).toBe(1);
      expect(records[0].instanceId).toBe("inst-1");
      expect(records[0].totalBookings).toBe(1);
      expect(records[0].totalHoursBooked).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
