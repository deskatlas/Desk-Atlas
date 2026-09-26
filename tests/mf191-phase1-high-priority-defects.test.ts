import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { POST as staffCheckInHandler } from "../apps/staff-dashboard/src/app/api/operations/reservations/[reservationId]/check-in/route";
import { POST as staffCheckOutHandler } from "../apps/staff-dashboard/src/app/api/operations/reservations/[reservationId]/check-out/route";
import { POST as adminCheckInHandler } from "../apps/admin-portal/src/app/api/operations/reservations/[reservationId]/check-in/route";
import { POST as adminCheckOutHandler } from "../apps/admin-portal/src/app/api/operations/reservations/[reservationId]/check-out/route";
import { POST as adminCancelHandler } from "../apps/admin-portal/src/app/api/admin/reservations/[id]/cancel/route";
import { _rateLimiterTesting } from "../apps/customer-website/src/app/api/track/route";
import { AdminReservationError } from "@deskatlas/domain";
import * as reservationServiceModule from "../apps/admin-portal/src/app/api/admin/reservations/_lib/reservationService";

describe("MF-191: Phase 1 High-Priority Defect Fixes & Data Hardening", () => {
  describe("DEF-RPC-01: Stored Procedure Parameter Deserialization (COALESCE support)", () => {
    it("ensures 002_functions.sql supports both camelCase and snake_case candidate keys", () => {
      const sqlPath = path.join(process.cwd(), "supabase", "002_functions.sql");
      const sqlContent = fs.readFileSync(sqlPath, "utf-8");

      // Verify create_reservation candidate recordset
      expect(sqlContent).toContain('COALESCE(x."workspaceInstanceId", x.workspace_instance_id) AS workspace_instance_id');
      expect(sqlContent).toContain('COALESCE(x."startAt", x.start_at) AS start_at');
      expect(sqlContent).toContain('COALESCE(x."endAt", x.end_at) AS end_at');

      // Verify jsonb_to_recordset column definitions include both casings
      const matches = sqlContent.match(/COALESCE\(x\."workspaceInstanceId", x\.workspace_instance_id\)/g);
      expect(matches).not.toBeNull();
      expect(matches?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("DEF-OPS-01: Eliminate Blind Staff Fallback in Operational Routes", () => {
    it("rejects staff check-in with 401 when actorUserId is missing or not a valid UUID", async () => {
      const req = new Request("http://localhost:3000/api/operations/reservations/res-123/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: { role: "STAFF" },
        }),
      });

      const res = await staffCheckInHandler(req, {
        params: Promise.resolve({ reservationId: "res-123" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("Actor user ID is required for check-in.");
    });

    it("rejects staff check-out with 401 when actorUserId is missing or not a valid UUID", async () => {
      const req = new Request("http://localhost:3000/api/operations/reservations/res-123/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: { userId: "invalid-uuid", role: "STAFF" },
        }),
      });

      const res = await staffCheckOutHandler(req, {
        params: Promise.resolve({ reservationId: "res-123" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("Actor user ID is required for check-out.");
    });

    it("rejects admin operational check-in with 401 when actorUserId is empty", async () => {
      const req = new Request("http://localhost:3000/api/operations/reservations/res-123/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await adminCheckInHandler(req, {
        params: Promise.resolve({ reservationId: "res-123" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("Actor user ID is required for check-in.");
    });

    it("rejects admin operational check-out with 401 when actorUserId is empty", async () => {
      const req = new Request("http://localhost:3000/api/operations/reservations/res-123/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await adminCheckOutHandler(req, {
        params: Promise.resolve({ reservationId: "res-123" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("Actor user ID is required for check-out.");
    });
  });

  describe("DEF-API-01: Rate Limiter In-Memory Heap Leak Prevention", () => {
    beforeEach(() => {
      _rateLimiterTesting.requestLog.clear();
    });

    it("prunes expired timestamps and deletes inactive client IP keys from requestLog", () => {
      const now = 1000000000000;
      const oldTime = now - _rateLimiterTesting.RATE_LIMIT_WINDOW_MS - 5000;

      // Seed map with expired IPs
      _rateLimiterTesting.requestLog.set("track:192.168.1.1", [oldTime]);
      _rateLimiterTesting.requestLog.set("track:192.168.1.2", [oldTime]);
      expect(_rateLimiterTesting.requestLog.size).toBe(2);

      // Consume rate limit for a new client IP
      const allowed = _rateLimiterTesting.consumeRateLimit("track:10.0.0.1", now);
      expect(allowed).toBe(true);

      // Expired IPs must be pruned
      expect(_rateLimiterTesting.requestLog.has("track:192.168.1.1")).toBe(false);
      expect(_rateLimiterTesting.requestLog.has("track:192.168.1.2")).toBe(false);
      expect(_rateLimiterTesting.requestLog.has("track:10.0.0.1")).toBe(true);
      expect(_rateLimiterTesting.requestLog.size).toBe(1);
    });

    it("enforces max attempt limit for active windows", () => {
      const now = 2000000000000;
      const key = "track:10.0.0.99";

      for (let i = 0; i < _rateLimiterTesting.RATE_LIMIT_MAX_ATTEMPTS; i++) {
        const allowed = _rateLimiterTesting.consumeRateLimit(key, now + i * 100);
        expect(allowed).toBe(true);
      }

      // Next attempt exceeds limit
      const exceeded = _rateLimiterTesting.consumeRateLimit(key, now + 5000);
      expect(exceeded).toBe(false);
    });
  });

  describe("DEF-API-02: HTTP Status Code Mapping for Reservation Cancellation", () => {
    it("returns 400 when cancellation reason is missing", async () => {
      const req = new Request("http://localhost:3000/api/admin/reservations/res-123/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "" }),
      });

      const res = await adminCancelHandler(req, {
        params: Promise.resolve({ id: "res-123" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toBe("Cancellation reason is required.");
    });

    it("maps AdminReservationError validation error to 400 instead of 500", async () => {
      const spy = vi.spyOn(reservationServiceModule, "getAdminReservationService").mockReturnValue({
        cancelReservation: vi.fn().mockRejectedValue(new AdminReservationError("Cannot cancel a completed reservation.")),
      } as unknown as ReturnType<typeof reservationServiceModule.getAdminReservationService>);

      try {
        const req = new Request("http://localhost:3000/api/admin/reservations/res-123/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Customer request", actorUserId: "00000000-0000-0000-0000-000000000001" }),
        });

        const res = await adminCancelHandler(req, {
          params: Promise.resolve({ id: "res-123" }),
        });

        expect(res.status).toBe(400);
        const json = await res.json() as { error: string };
        expect(json.error).toBe("Cannot cancel a completed reservation.");
      } finally {
        spy.mockRestore();
      }
    });

    it("maps not found errors to 404", async () => {
      const spy = vi.spyOn(reservationServiceModule, "getAdminReservationService").mockReturnValue({
        cancelReservation: vi.fn().mockRejectedValue(new Error("Reservation not found: res-999")),
      } as unknown as ReturnType<typeof reservationServiceModule.getAdminReservationService>);

      try {
        const req = new Request("http://localhost:3000/api/admin/reservations/res-999/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Customer request", actorUserId: "00000000-0000-0000-0000-000000000001" }),
        });

        const res = await adminCancelHandler(req, {
          params: Promise.resolve({ id: "res-999" }),
        });

        expect(res.status).toBe(404);
        const json = await res.json() as { error: string };
        expect(json.error).toContain("not found");
      } finally {
        spy.mockRestore();
      }
    });
  });
});
