/**
 * Regression coverage for atomic payment approval recovery.
 * Traceability: PRD-F6, SDD-C5, ERD-E10, ERD-E11, ERD-E13, QAD-TC7 through QAD-TC10.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ReservationSupabaseRepository } from "@deskatlas/domain";

describe("MF-192: payment allocation atomicity regression", () => {
  it("never falls back to separate REST mutations when the allocation RPC is unavailable", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({ code: "PGRST202", message: "RPC is unavailable" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    };
    const repository = new ReservationSupabaseRepository({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      fetcher,
    });

    await expect(
      repository.approvePaymentAndAllocate({
        paymentAttemptId: "80f521cb-3666-45d1-b0ee-dbfdba9b21f0",
        actorUserId: "00000000-0000-0000-0000-000000000001",
        processedAt: "2026-10-12T04:15:56.458Z",
      })
    ).rejects.toThrow("Supabase request failed (404)");

    expect(requests).toEqual([
      "https://example.supabase.co/rest/v1/rpc/approve_online_payment_and_allocate",
    ]);
  });

  it("ships a forward migration that repairs approved attempts without an assignment", () => {
    const migration = readFileSync(
      resolve(import.meta.dirname, "../supabase/migrations/008_repair_atomic_payment_allocation.sql"),
      "utf8"
    );

    expect(migration).toContain("IF v_attempt.status = 'APPROVED' THEN");
    expect(migration).toContain("AND v_reservation.status = 'PAYMENT_UNDER_REVIEW'");
    expect(migration).toContain("ELSIF v_should_allocate THEN");
    expect(migration).toContain("WHEN v_attempt.status = 'APPROVED' THEN 'payment_review_allocation_recovered'");
    expect(migration).toContain("FOR UPDATE OF rc");
    expect(migration).toContain("WHEN exclusion_violation THEN");
    expect(migration).toContain("PERFORM public.process_confirmed_reservation_identity_and_outbox");
    expect(migration).toContain("payment_review_partial_transition_requeued");
    expect(migration).toContain("status = 'UNDER_REVIEW'");
    expect(migration).toContain("processed_by_user_id = NULL");
  });

  it("qualifies payment processor columns that collide with RPC output parameters", () => {
    const migration = readFileSync(
      resolve(import.meta.dirname, "../supabase/migrations/009_fix_payment_allocation_column_ambiguity.sql"),
      "utf8"
    );

    expect(migration).toContain("UPDATE public.payment_attempts AS pa");
    expect(migration).toContain(
      "processed_by_user_id = COALESCE(pa.processed_by_user_id, p_processed_by_user_id)"
    );
    expect(migration).toContain("processed_at = COALESCE(pa.processed_at, p_processed_at)");
    expect(migration).toContain("WHERE pa.id = v_attempt.id");
    expect(migration).not.toContain(
      "processed_by_user_id = COALESCE(processed_by_user_id, p_processed_by_user_id)"
    );
  });

  it("makes the Supabase pgcrypto schema visible to customer code generation", () => {
    const migration = readFileSync(
      resolve(import.meta.dirname, "../supabase/migrations/010_fix_customer_identity_pgcrypto_resolution.sql"),
      "utf8"
    );

    expect(migration).toContain("to_regprocedure('extensions.gen_random_bytes(integer)')");
    expect(migration).toContain(
      "ALTER FUNCTION public.process_confirmed_reservation_identity_and_outbox(uuid, timestamptz)"
    );
    expect(migration).toContain("SET search_path TO public, extensions");
  });
});
