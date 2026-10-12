"use client";

import { useEffect, useState } from "react";
import type { RewardsSession } from "../context/RewardsSessionContext";

interface BookingItem {
  id: string;
  reference_code: string;
  source: string;
  status: string;
  start_at: string;
  end_at: string;
  workspace_name?: string | null;
  amount_due: number;
  currency: string;
  created_at: string;
  is_pre_cutover: boolean;
}

interface VoucherItem {
  id: string;
  promo_code: string;
  status: "AVAILABLE" | "PENDING_REDEMPTION" | "USED" | "EXPIRED";
  campaign_name_snapshot: string;
  reward_snapshot: {
    rewardType: "PERCENTAGE_DISCOUNT" | "FIXED_AMOUNT_DISCOUNT";
    rewardValue: number;
    maxDiscountAmount?: number | null;
    voucherValidityDays: number;
    redemptionChannels?: string[];
    redemptionWorkspaceTypeIds?: string[];
    minimumBookingAmount?: number;
  };
  issued_at: string;
  expires_at: string;
  pending_reservation_id?: string | null;
  pending_reservation_reference?: string | null;
  held_at?: string | null;
  redeemed_at?: string | null;
  redeemed_reservation_id?: string | null;
  redeemed_discount_amount?: number | null;
}

interface RuleProgress {
  campaign_id: string;
  rule_id: string;
  label: string;
  combine: "ALL" | "ANY";
  conditions: Array<{
    metric: string;
    current: number;
    threshold: number;
    remaining: number;
  }>;
  next_milestone: number;
  completed: boolean;
}

interface RewardsVoucherDashboardProps {
  session: RewardsSession;
  onSessionExpired?: () => void;
}

export function RewardsVoucherDashboard({
  session,
  onSessionExpired,
}: RewardsVoucherDashboardProps) {
  const { accessToken, customer } = session;

  // Portal view state
  const [activeTab, setActiveTab] = useState<"AVAILABLE" | "USED" | "EXPIRED">("AVAILABLE");
  const [vouchers, setVouchers] = useState<VoucherItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [qualifyingCount, setQualifyingCount] = useState<number>(0);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Eligibility checking state
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  const [eligibilityProgress, setEligibilityProgress] = useState<RuleProgress[] | null>(null);
  const [eligibilityNotice, setEligibilityNotice] = useState<string | null>(null);

  // Email voucher status state
  const [emailingVoucherId, setEmailingVoucherId] = useState<string | null>(null);
  const [emailStatusMessage, setEmailStatusMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Load vouchers and bookings when accessToken changes or tab changes
  useEffect(() => {
    let isMounted = true;
    setIsLoadingData(true);

    const loadData = async () => {
      try {
        // Load vouchers for current tab
        const vouchersRes = await fetch("/api/customer/vouchers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ status: activeTab }),
        });

        if (vouchersRes.status === 401) {
          onSessionExpired?.();
          return;
        }

        const vouchersJson = await vouchersRes.json();
        if (isMounted && vouchersJson.data) {
          setVouchers(vouchersJson.data.items || []);
        }

        // Load bookings
        const bookingsRes = await fetch("/api/customer/bookings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ limit: 20 }),
        });

        if (bookingsRes.status === 401) {
          onSessionExpired?.();
          return;
        }

        const bookingsJson = await bookingsRes.json();
        if (isMounted && bookingsJson.data) {
          setBookings(bookingsJson.data.items || []);
          setQualifyingCount(bookingsJson.data.qualifying_booking_count || 0);
        }
      } catch (err) {
        console.error("Failed to load customer portal data:", err);
      } finally {
        if (isMounted) setIsLoadingData(false);
      }
    };

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [accessToken, activeTab, onSessionExpired]);

  const handleCheckEligibility = async () => {
    if (isCheckingEligibility) return;
    setIsCheckingEligibility(true);
    setEligibilityNotice(null);

    try {
      const res = await fetch("/api/customer/check-eligibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });

      if (res.status === 401) {
        onSessionExpired?.();
        return;
      }

      const json = await res.json();
      if (json.data) {
        setEligibilityProgress(json.data.progress || []);
        if (json.data.new_vouchers && json.data.new_vouchers.length > 0) {
          setEligibilityNotice(
            `Congratulations! You earned ${json.data.new_vouchers.length} new reward voucher(s)!`
          );
          // Refresh voucher list
          const vouchersRes = await fetch("/api/customer/vouchers", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ status: activeTab }),
          });
          const vJson = await vouchersRes.json();
          if (vJson.data) setVouchers(vJson.data.items || []);
        } else {
          setEligibilityNotice("Your reward progress is up to date.");
        }
      }
    } catch {
      setEligibilityNotice("Unable to check eligibility. Please try again later.");
    } finally {
      setIsCheckingEligibility(false);
    }
  };

  const handleEmailVoucher = async (voucherId: string) => {
    if (emailingVoucherId) return;
    setEmailingVoucherId(voucherId);
    setEmailStatusMessage("Voucher email queued");

    try {
      const requestId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `req-${Date.now()}`;
      const res = await fetch("/api/customer/email-voucher", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          voucher_id: voucherId,
          request_id: requestId,
        }),
      });

      if (res.status === 401) {
        onSessionExpired?.();
        return;
      }

      const json = await res.json();
      if (res.ok && json.data) {
        const notificationId = json.data.notification_id;
        setEmailStatusMessage("Voucher email queued");

        // Poll for sent status
        setTimeout(async () => {
          try {
            const statusRes = await fetch("/api/customer/email-voucher/status", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ notification_id: notificationId }),
            });
            const sJson = await statusRes.json();
            if (sJson.data?.status === "SENT") {
              setEmailStatusMessage("Sent to your registered email");
            } else if (sJson.data?.status === "FAILED") {
              setEmailStatusMessage("Delivery failed. Please try again.");
            }
          } catch {
            // Keep existing status
          }
        }, 1500);
      } else {
        setEmailStatusMessage(json.error?.message || "Unable to queue voucher email.");
      }
    } catch {
      setEmailStatusMessage("Unable to send voucher email.");
    } finally {
      setTimeout(() => {
        setEmailingVoucherId(null);
      }, 3000);
    }
  };

  const copyToClipboard = (code: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    }
  };

  const formattedIssuedDate = new Date(customer.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="mt-8 grid gap-8" data-testid="rewards-portal-view">
      {/* Customer Header Card */}
      <div className="rounded-[24px] border border-[var(--da-border)] bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
              Verified Guest
            </span>
            <h2 className="mt-2 text-2xl font-black text-white">
              {customer.firstName} {customer.lastName}
            </h2>
            <p className="text-xs text-slate-300 font-mono mt-0.5">{customer.email}</p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-2xl bg-white/10 p-3.5 backdrop-blur-sm border border-white/10 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Customer ID
              </span>
              <span className="font-mono text-xl font-extrabold tracking-widest text-emerald-400">
                {customer.customerCode}
              </span>
            </div>

            <div className="rounded-2xl bg-white/10 p-3.5 backdrop-blur-sm border border-white/10 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Customer ID issued
              </span>
              <span className="text-sm font-semibold text-white">
                {formattedIssuedDate}
              </span>
            </div>

            <div className="rounded-2xl bg-white/10 p-3.5 backdrop-blur-sm border border-white/10 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Qualifying Bookings
              </span>
              <span className="text-xl font-black text-emerald-400">
                {qualifyingCount}
              </span>
            </div>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-slate-400 border-t border-white/10 pt-3">
          Notice: Customer ID is an identifier permanently bound to your email address. Individual promotional campaigns may evaluate a narrower count.
        </p>
      </div>

      {/* Rewards Vouchers Section */}
      <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--da-border-light)] pb-5">
          <div>
            <h3 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
              My Loyalty Vouchers
            </h3>
            <p className="text-xs text-[var(--da-text-secondary)]">
              Single-use promotional discounts earned through qualifying coworking visits.
            </p>
          </div>

          <button
            type="button"
            disabled={isCheckingEligibility}
            onClick={handleCheckEligibility}
            className="da-primary-button text-xs font-bold px-4 py-2.5 disabled:opacity-50"
            data-testid="eligibility-check-button"
          >
            {isCheckingEligibility ? "Checking..." : "Am I eligible for rewards?"}
          </button>
        </div>

        {eligibilityNotice && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
            {eligibilityNotice}
          </div>
        )}

        {/* Live campaign progress if available */}
        {eligibilityProgress && eligibilityProgress.length > 0 && (
          <div className="mt-5 rounded-2xl bg-slate-50 border border-slate-200 p-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Active Campaign Progress
            </h4>
            <div className="grid gap-3">
              {eligibilityProgress.map((prog) => (
                <div
                  key={prog.rule_id}
                  className="rounded-xl bg-white border border-slate-200 p-3.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">{prog.label}</span>
                    {prog.completed ? (
                      <span className="rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-[10px] font-bold">
                        Completed
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-slate-500">
                        Milestone {prog.next_milestone}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid gap-1.5 text-slate-600">
                    {prog.conditions.map((c, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[11px]">
                        <span>
                          {c.current} of {c.threshold} {c.metric.toLowerCase().replace("_", " ")} toward your next reward
                        </span>
                        <span className="font-semibold text-slate-700">{c.remaining} remaining</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="mt-6 flex gap-2 border-b border-slate-200 pb-2">
          {(["AVAILABLE", "USED", "EXPIRED"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                activeTab === tab
                  ? "bg-[var(--da-primary)] text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              data-testid={`voucher-tab-${tab.toLowerCase()}`}
            >
              {tab.charAt(0) + tab.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Vouchers List */}
        <div className="mt-6">
          {isLoadingData ? (
            <p className="text-center text-xs text-slate-400 py-8">Loading vouchers...</p>
          ) : vouchers.length === 0 ? (
            <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <p className="text-sm font-semibold text-slate-500">
                No {activeTab.toLowerCase()} vouchers found.
              </p>
              {activeTab === "AVAILABLE" && (
                <p className="text-xs text-slate-400 mt-1">
                  Click "Am I eligible for rewards?" to check for qualifying milestones.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {vouchers.map((v) => {
                const discountText =
                  v.reward_snapshot.rewardType === "PERCENTAGE_DISCOUNT"
                    ? `${v.reward_snapshot.rewardValue}% DISCOUNT`
                    : `PHP ${v.reward_snapshot.rewardValue} OFF`;

                const expiryDate = new Date(v.expires_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });

                return (
                  <div
                    key={v.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                          {v.campaign_name_snapshot}
                        </span>
                        <h4 className="text-lg font-black text-slate-900 mt-0.5">
                          {discountText}
                        </h4>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${
                          v.status === "AVAILABLE"
                            ? "bg-emerald-100 text-emerald-800"
                            : v.status === "PENDING_REDEMPTION"
                            ? "bg-amber-100 text-amber-800"
                            : v.status === "USED"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {v.status === "PENDING_REDEMPTION" ? "ON HOLD" : v.status}
                      </span>
                    </div>

                    {(v.status === "PENDING_REDEMPTION" || (v as unknown as { effectiveStatus?: string }).effectiveStatus === "PENDING_REDEMPTION") && (
                      <div className="flex items-center gap-2 mt-2">
                        <span
                          data-testid="voucher-status-pending"
                          className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800"
                        >
                          ON HOLD / PENDING
                        </span>
                        <span className="text-xs text-slate-500">
                          Reserved for booking awaiting review
                        </span>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                      <span className="font-mono text-sm font-black tracking-widest text-slate-900 select-all">
                        {v.promo_code}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(v.promo_code)}
                        className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 border border-slate-300 hover:bg-slate-100 transition-colors"
                        title={v.status === "PENDING_REDEMPTION" ? "This code is currently on hold for an unconfirmed reservation." : "Copy promo code"}
                      >
                        {copiedCode === v.promo_code ? "Copied!" : "Copy Code"}
                      </button>
                    </div>

                    <div className="mt-3 text-[11px] text-slate-500 space-y-1">
                      <p>
                        Expires: <span className="font-semibold text-slate-700">{expiryDate}</span>
                      </p>
                      {v.reward_snapshot.maxDiscountAmount && (
                        <p>Max discount cap: PHP {v.reward_snapshot.maxDiscountAmount}</p>
                      )}
                      {v.status === "USED" && v.redeemed_reservation_id && (
                        <p className="text-slate-600 font-medium">
                          Redeemed discount: PHP {v.redeemed_discount_amount || 0}
                        </p>
                      )}
                    </div>

                    {v.status === "AVAILABLE" && (
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={emailingVoucherId === v.id}
                          onClick={() => handleEmailVoucher(v.id)}
                          className="da-secondary-button text-[11px] font-bold py-1.5 px-3 w-full text-center"
                        >
                          {emailingVoucherId === v.id ? "Queuing..." : "Email Me This Voucher"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {emailStatusMessage && (
          <div className="mt-4 rounded-xl bg-slate-900 text-white p-3 text-xs font-semibold text-center">
            {emailStatusMessage}
          </div>
        )}
      </div>

      {/* Booking History Section */}
      <div className="rounded-[28px] border border-[var(--da-border)] bg-white p-8 shadow-sm">
        <h3 className="text-xl font-extrabold text-[var(--da-brand-dark)]">
          My Booking History
        </h3>
        <p className="text-xs text-[var(--da-text-secondary)] mt-0.5">
          Confirmed reservations linked to your registered email address.
        </p>

        <div className="mt-6 overflow-x-auto">
          {bookings.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-6">
              No historical reservations found for {customer.email}.
            </p>
          ) : (
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-3">Reference</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Workspace</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Schedule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/50">
                    <td className="p-3 font-mono font-bold text-slate-900">
                      {b.reference_code}
                    </td>
                    <td className="p-3 font-semibold">{b.source}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-[10px] text-slate-700">
                        {b.status}
                      </span>
                    </td>
                    <td className="p-3">{b.workspace_name || "Workspace"}</td>
                    <td className="p-3 font-semibold text-slate-900">
                      {b.currency} {b.amount_due}
                    </td>
                    <td className="p-3 text-slate-500">
                      {new Date(b.start_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
