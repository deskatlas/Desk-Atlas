"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  type AdminReservationDetail as AdminReservationDetailType,
  formatTimelineDate,
  formatSchedule,
  zonedDateTimeToUtc,
} from '@deskatlas/domain';
import { ProofImageViewer } from '../../payments/components/ProofImageViewer';
import { ExtendReservationModal } from './ExtendReservationModal';
import { useAuth } from '../../auth/components/AuthProvider';

export function canViewBookingQr(detail: AdminReservationDetailType | null): boolean {
  if (!detail) return false;
  const isEligibleStatus = detail.reservationStatus === 'CONFIRMED' || detail.reservationStatus === 'CHECKED_IN';
  if (!isEligibleStatus) return false;
  if (detail.qrRevokedAt) return false;
  return Boolean(detail.bookingToken || detail.bookingAccessUrl || detail.hasBookingQr);
}

export function getBookingQrValue(detail: AdminReservationDetailType): string {
  return detail.bookingAccessUrl || detail.bookingToken || detail.referenceCode;
}

export function getTodayManila(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function getManilaDateAndTimeString(isoString: string): { date: string; time: string } {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  let hour = parts.find((p) => p.type === "hour")?.value ?? "08";
  if (hour === "24") hour = "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
}

export function formatTime12Hour(timeStr: string): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = Number(hStr);
  const m = Number(mStr) || 0;
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minStr = String(m).padStart(2, '0');
  return `${hour12}:${minStr} ${ampm}`;
}

const CANCELLATION_REASONS = [
  "Customer Request",
  "Facility Maintenance",
  "Payment Reversal",
  "No-Show",
  "Double Booking / Schedule Conflict",
  "Other",
];

const RELOCATION_REASONS = [
  "Spot Maintenance / Repairs",
  "Spot Inactive / Out of Order",
  "Facility Issue",
  "Customer Request / Operational Adjustment",
  "Other",
];

const TIME_OPTIONS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
  "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30",
  "20:00", "20:30", "21:00", "21:30", "22:00"
];

const DURATION_OPTIONS = [
  { label: "1 hour", value: 1 },
  { label: "2 hours", value: 2 },
  { label: "3 hours", value: 3 },
  { label: "4 hours", value: 4 },
  { label: "5 hours", value: 5 },
  { label: "6 hours", value: 6 },
  { label: "8 hours (Full Day)", value: 8 },
];

export function ReservationDetail({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [detail, setDetail] = useState<AdminReservationDetailType | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Cancellation modal states
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>("Customer Request");
  const [cancelNotes, setCancelNotes] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Relocation modal states
  const [showRelocateModal, setShowRelocateModal] = useState<boolean>(false);
  const [relocationSpots, setRelocationSpots] = useState<any[]>([]);
  const [selectedRelocationSpotId, setSelectedRelocationSpotId] = useState<string>("");
  const [relocationReason, setRelocationReason] = useState<string>("Spot Maintenance / Repairs");
  const [relocationNotes, setRelocationNotes] = useState<string>("");
  const [isRelocating, setIsRelocating] = useState<boolean>(false);
  const [isLoadingRelocationSpots, setIsLoadingRelocationSpots] = useState<boolean>(false);
  const [relocateError, setRelocateError] = useState<string | null>(null);

  // Pending relocation decision states
  const [isDecidingRelocation, setIsDecidingRelocation] = useState<boolean>(false);
  const [relocationDecisionError, setRelocationDecisionError] = useState<string | null>(null);

  // Reschedule modal states
  const [showRescheduleModal, setShowRescheduleModal] = useState<boolean>(false);
  const [catalogInstances, setCatalogInstances] = useState<any[]>([]);
  const [selectedSpotId, setSelectedSpotId] = useState<string>("");
  const [rescheduleDate, setRescheduleDate] = useState<string>("");
  const [rescheduleStartTime, setRescheduleStartTime] = useState<string>("09:00");
  const [rescheduleDuration, setRescheduleDuration] = useState<number>(1);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState<boolean>(false);
  const [availabilityResult, setAvailabilityResult] = useState<{
    available: boolean;
    reason?: string;
    slots?: Array<{
      startTime: string;
      endTime: string;
      startAt: string;
      endAt: string;
      isAvailable: boolean;
      reason?: string;
    }>;
  } | null>(null);
  const [isRescheduling, setIsRescheduling] = useState<boolean>(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [showExtendModal, setShowExtendModal] = useState<boolean>(false);

  // Payment proof inspection modal states
  const [viewingProofAttemptId, setViewingProofAttemptId] = useState<string | null>(null);
  const [viewingProofUrl, setViewingProofUrl] = useState<string | null>(null);
  const [loadingProofUrl, setLoadingProofUrl] = useState<boolean>(false);

  const handleOpenProofModal = async (paymentAttemptId: string) => {
    setViewingProofAttemptId(paymentAttemptId);
    setViewingProofUrl(null);
    setLoadingProofUrl(true);
    try {
      const res = await fetch(`/api/admin/payments/reviews/${encodeURIComponent(paymentAttemptId)}/proof`);
      if (res.ok) {
        const data = await res.json();
        if (data.signedUrl) {
          setViewingProofUrl(data.signedUrl);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingProofUrl(false);
    }
  };

  const fetchDetail = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/reservations/${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Reservation ${id} not found.`);
        }
        throw new Error(`Failed to load reservation (${response.status})`);
      }
      const data = await response.json();
      setDetail(data);
      return data;
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load reservation detail');
      return null;
    }
  }, [id]);

  useEffect(() => {
    let isCancelled = false;

    async function loadDetail() {
      setLoading(true);
      setError(null);
      await fetchDetail();
      if (!isCancelled) {
        setLoading(false);
      }
    }

    loadDetail();

    return () => {
      isCancelled = true;
    };
  }, [fetchDetail]);

  // Load catalog instances for same-template spot selection when reschedule modal opens
  useEffect(() => {
    if (showRescheduleModal) {
      fetch('/api/admin/workspaces', { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          if (data.instances && Array.isArray(data.instances)) {
            setCatalogInstances(data.instances);
          }
        })
        .catch(() => {});
    }
  }, [showRescheduleModal]);

  const effectiveCandidate = detail?.assignedCandidate || detail?.candidates?.[0];

  // Filter instances belonging to the same template tier
  const sameTemplateInstances = React.useMemo(() => {
    if (!catalogInstances.length || !detail) return [];
    const currentInstanceId = effectiveCandidate?.workspaceInstanceId;
    const currentInst = catalogInstances.find(
      (i) => i.id === currentInstanceId || i.displayName === effectiveCandidate?.workspaceDisplayName
    );
    const currentTemplateId = currentInst?.templateId;
    const currentTemplateName = detail.assignedCandidate?.workspaceTemplateName;

    return catalogInstances.filter((i) => {
      if (i.operationalStatus === 'INACTIVE') return false;
      if (currentTemplateId && i.templateId) {
        return i.templateId === currentTemplateId;
      }
      if (currentTemplateName && (i.template?.name || i.workspaceTemplateName)) {
        return (i.template?.name || i.workspaceTemplateName) === currentTemplateName;
      }
      return true;
    });
  }, [catalogInstances, detail, effectiveCandidate]);

  // Pre-fill reschedule form when detail loads
  useEffect(() => {
    if (detail) {
      const candidate = detail.assignedCandidate || detail.candidates?.[0];
      if (candidate?.workspaceInstanceId) {
        setSelectedSpotId(candidate.workspaceInstanceId);
      }
      if (candidate?.startAt) {
        try {
          const startDate = new Date(candidate.startAt);
          const { date: candidateDate, time: candidateTime } = getManilaDateAndTimeString(candidate.startAt);
          const todayManila = getTodayManila();
          
          const isDateInPast = candidateDate < todayManila;
          const initialDate = isDateInPast ? todayManila : candidateDate;
          setRescheduleDate(initialDate);

          // Check if candidate start time on initialDate is in the past
          const candidateStartUtc = zonedDateTimeToUtc(initialDate, candidateTime, "Asia/Manila");
          if (candidateStartUtc.getTime() <= Date.now()) {
            setRescheduleStartTime("");
          } else {
            const closestTime = TIME_OPTIONS.find((t) => t === candidateTime) || candidateTime;
            setRescheduleStartTime(closestTime);
          }

          if (candidate.endAt) {
            const endDate = new Date(candidate.endAt);
            const hours = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)));
            setRescheduleDuration(hours);
          }
        } catch {
          setRescheduleDate(getTodayManila());
          setRescheduleStartTime("");
        }
      }
    }
  }, [detail]);

  // Check availability when reschedule inputs change
  useEffect(() => {
    if (!showRescheduleModal || !rescheduleDate) return;

    let isCancelled = false;

    async function checkAvailability() {
      setIsCheckingAvailability(true);
      setRescheduleError(null);
      try {
        const targetSpot = selectedSpotId || effectiveCandidate?.workspaceInstanceId;
        const params = new URLSearchParams({
          date: rescheduleDate,
          durationHours: String(rescheduleDuration),
        });
        if (targetSpot) {
          params.set('workspaceInstanceId', targetSpot);
        }
        if (rescheduleStartTime) {
          const start = zonedDateTimeToUtc(rescheduleDate, rescheduleStartTime, "Asia/Manila");
          const end = new Date(start.getTime() + rescheduleDuration * 60 * 60 * 1000);
          params.set('startAt', start.toISOString());
          params.set('endAt', end.toISOString());
        }

        const res = await fetch(
          `/api/admin/reservations/${encodeURIComponent(id)}/reschedule/availability?${params.toString()}`,
          { cache: 'no-store' }
        );
        const data = await res.json();
        if (!isCancelled) {
          setAvailabilityResult(data);
          // If current selected start time is booked or past, clear it
          if (rescheduleStartTime) {
            const slotDateUtc = zonedDateTimeToUtc(rescheduleDate, rescheduleStartTime, "Asia/Manila");
            const isPast = slotDateUtc.getTime() <= Date.now();
            if (isPast) {
              setRescheduleStartTime("");
            } else if (data.slots) {
              const currentSlot = data.slots.find((s: any) => s.startTime === rescheduleStartTime);
              if (currentSlot && !currentSlot.isAvailable) {
                setRescheduleStartTime("");
              }
            }
          }
        }
      } catch {
        if (!isCancelled) {
          setAvailabilityResult({ available: true });
        }
      } finally {
        if (!isCancelled) {
          setIsCheckingAvailability(false);
        }
      }
    }

    const timer = setTimeout(checkAvailability, 250);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [showRescheduleModal, rescheduleDate, rescheduleStartTime, rescheduleDuration, selectedSpotId, id, effectiveCandidate]);

  // Load available relocation spots when relocate modal opens
  useEffect(() => {
    if (showRelocateModal && id) {
      let isCancelled = false;
      setIsLoadingRelocationSpots(true);
      setRelocateError(null);
      fetch(`/api/admin/reservations/${encodeURIComponent(id)}/available-relocation-spots`, { cache: 'no-store' })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load available spots');
          return res.json();
        })
        .then((data) => {
          if (!isCancelled) {
            const spots = data.spots || [];
            setRelocationSpots(spots);
            if (spots.length > 0) {
              setSelectedRelocationSpotId(spots[0].id);
            } else {
              setSelectedRelocationSpotId("");
            }
          }
        })
        .catch((err) => {
          if (!isCancelled) {
            setRelocateError(err.message || 'Failed to load available relocation spots');
          }
        })
        .finally(() => {
          if (!isCancelled) {
            setIsLoadingRelocationSpots(false);
          }
        });

      return () => {
        isCancelled = true;
      };
    }
  }, [showRelocateModal, id]);

  const handleConfirmRelocation = async () => {
    if (!selectedRelocationSpotId) {
      setRelocateError("Please select an available target spot.");
      return;
    }
    if (!relocationReason) {
      setRelocateError("Please select a relocation reason.");
      return;
    }

    setIsRelocating(true);
    setRelocateError(null);
    try {
      const actorRole = user?.isSuperAdmin ? "SUPERADMIN" : "ADMIN";
      const response = await fetch(`/api/admin/reservations/${encodeURIComponent(id)}/relocate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user?.id ? { "x-user-id": user.id } : {}),
        },
        body: JSON.stringify({
          targetWorkspaceInstanceId: selectedRelocationSpotId,
          reason: relocationReason,
          notes: relocationNotes || undefined,
          actorRole,
          actorUserId: user?.id || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to relocate reservation");
      }

      if (data.reservation) {
        setDetail(data.reservation);
      } else {
        await fetchDetail();
      }

      setShowRelocateModal(false);
      setToastMessage({ text: "Reservation relocated successfully.", type: "success" });
    } catch (err: any) {
      setRelocateError(err?.message || "Failed to relocate reservation");
    } finally {
      setIsRelocating(false);
    }
  };

  const handleDecideRelocation = async (decision: "APPROVE" | "DECLINE") => {
    let declineNotes = "";
    if (decision === "DECLINE") {
      const inputNotes = window.prompt("Enter optional reason for declining this relocation request:");
      if (inputNotes === null) return;
      declineNotes = inputNotes;
    }

    setIsDecidingRelocation(true);
    setRelocationDecisionError(null);
    try {
      const actorRole = user?.isSuperAdmin ? "SUPERADMIN" : "ADMIN";
      const res = await fetch(`/api/admin/reservations/${encodeURIComponent(id)}/relocate/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user?.id ? { "x-user-id": user.id } : {}),
        },
        body: JSON.stringify({
          decision,
          notes: declineNotes || undefined,
          actorRole,
          actorUserId: user?.id || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to process relocation decision");
      }

      if (data.reservation) {
        setDetail(data.reservation);
      } else {
        await fetchDetail();
      }

      setToastMessage({
        text: decision === "APPROVE" ? "Customer relocation request approved successfully." : "Customer relocation request declined.",
        type: "success",
      });
    } catch (err: any) {
      setRelocationDecisionError(err?.message || "Failed to process decision");
    } finally {
      setIsDecidingRelocation(false);
    }
  };

  const handleConfirmCancellation = async () => {
    if (!cancelReason) {
      setCancelError("Please select a cancellation reason.");
      return;
    }

    setIsCancelling(true);
    setCancelError(null);
    try {
      const response = await fetch(`/api/admin/reservations/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: cancelReason,
          notes: cancelNotes,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to cancel reservation");
      }

      if (data.reservation) {
        setDetail(data.reservation);
      } else {
        await fetchDetail();
      }

      setShowCancelModal(false);
      setToastMessage({ text: "Reservation cancelled successfully.", type: "success" });
    } catch (err: any) {
      setCancelError(err?.message || "Failed to cancel reservation");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleConfirmReschedule = async () => {
    if (!rescheduleDate || !rescheduleStartTime) {
      setRescheduleError("Please select a valid date and available start time.");
      return;
    }

    const start = zonedDateTimeToUtc(rescheduleDate, rescheduleStartTime, "Asia/Manila");
    if (start.getTime() <= Date.now()) {
      setRescheduleError("Cannot reschedule to a past date or time.");
      return;
    }

    setIsRescheduling(true);
    setRescheduleError(null);
    try {
      const end = new Date(start.getTime() + rescheduleDuration * 60 * 60 * 1000);

      const response = await fetch(`/api/admin/reservations/${encodeURIComponent(id)}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          workspaceInstanceId: selectedSpotId || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to reschedule reservation");
      }

      if (data.reservation) {
        setDetail(data.reservation);
      } else {
        await fetchDetail();
      }

      setShowRescheduleModal(false);
      setToastMessage({ text: "Reservation rescheduled successfully.", type: "success" });
    } catch (err: any) {
      setRescheduleError(err?.message || "Failed to reschedule reservation");
    } finally {
      setIsRescheduling(false);
    }
  };

  const detailFields = detail
    ? [
        { label: 'Customer Name', value: detail.customerName },
        { label: 'Email', value: detail.customerEmail },
        { label: 'Schedule', value: detail.schedule },
        { label: 'Duration', value: detail.duration },
        { label: 'Payment Status', value: detail.paymentStatus },
        ...(detail.reservationStatus === 'CANCELLED'
          ? [
              {
                label: 'Cancellation Reason',
                value: detail.cancellationReason || 'Administrative Cancellation',
              },
              {
                label: 'Cancelled At',
                value: detail.cancelledAt
                  ? formatTimelineDate(detail.cancelledAt)
                  : formatTimelineDate(detail.updatedAt),
              },
            ]
          : []),
        ...(detail.reservationStatus === 'EXPIRED' || (detail.paymentAttempts && detail.paymentAttempts.length > 0)
          ? [
              {
                label: 'Payment Attempt',
                value: detail.paymentAttempts && detail.paymentAttempts.length > 0
                  ? `${detail.paymentAttempts[0].channel} (${detail.paymentAttempts[0].status})`
                  : 'None',
              },
              {
                label: 'Proof Uploaded',
                value: detail.proofSubmittedAt
                  ? `Yes (${formatTimelineDate(detail.proofSubmittedAt)})`
                  : 'No proof uploaded',
              },
              ...(detail.expiryReason
                ? [{ label: 'Expiry Reason', value: detail.expiryReason }]
                : []),
            ]
          : []),
      ]
    : [
        { label: 'Customer Name', value: '...' },
        { label: 'Email', value: '...' },
        { label: 'Schedule', value: '...' },
        { label: 'Duration', value: '...' },
        { label: 'Payment Status', value: '...' },
      ];

  const isConfirmed = detail?.reservationStatus === 'CONFIRMED' || detail?.reservationStatus === 'CHECKED_IN';
  const detailActions: Array<{
    label: string;
    style: React.CSSProperties;
    onClick?: () => void;
    testId?: string;
  }> = [];

  if (isConfirmed) {
    detailActions.push({
      label: 'Relocate Spot',
      style: { background: 'transparent', color: '#0D9488', border: '1px solid #99F6E4' },
      onClick: () => setShowRelocateModal(true),
      testId: 'relocate-booking-button',
    });
    detailActions.push({
      label: 'Reschedule',
      style: { background: 'transparent', color: 'var(--da-text-primary)', border: '1px solid var(--da-border)' },
      onClick: () => setShowRescheduleModal(true),
      testId: 'reschedule-booking-button',
    });
    detailActions.push({
      label: 'Cancel Booking',
      style: { background: 'transparent', color: 'var(--da-danger)', border: '1px solid #FECACA' },
      onClick: () => setShowCancelModal(true),
      testId: 'cancel-booking-button',
    });
    if (canViewBookingQr(detail)) {
      detailActions.push({
        label: 'View QR Code',
        style: { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' },
        onClick: () => setShowQrModal(true),
        testId: 'view-qr-code-button',
      });
    }
  }

  const detailCandidates = detail?.candidates && detail.candidates.length > 0
    ? detail.candidates.map((c) => ({
        tier: c.tier + (c.isAssigned ? ' • ALLOCATED' : ''),
        name: c.workspaceDisplayName || c.workspaceInstanceCode || 'Spot',
        color: c.isAssigned ? 'var(--da-brand-dark)' : c.color,
      }))
    : [];

  const detailTimeline = detail?.timeline && detail.timeline.length > 0
    ? detail.timeline
    : ['Reservation recorded'];

  if (loading) {
    return (
      <main data-screen-label="Reservation Detail" style={{ padding: '26px 28px 40px' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/reservations'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Reservations</a>
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
          Loading reservation details...
        </div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main data-screen-label="Reservation Detail" style={{ padding: '26px 28px 40px' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/reservations'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Reservations</a>
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--da-danger)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
          {error ?? 'Reservation not found.'}
        </div>
      </main>
    );
  }

  const allocatedSpotName = detail.assignedCandidate?.workspaceDisplayName || detail.candidates?.[0]?.workspaceDisplayName || "Spot";

  // Calculate new schedule preview string for reschedule modal
  let newSchedulePreview = "Invalid Date/Time";
  if (rescheduleDate && rescheduleStartTime) {
    try {
      const start = zonedDateTimeToUtc(rescheduleDate, rescheduleStartTime, "Asia/Manila");
      const end = new Date(start.getTime() + rescheduleDuration * 60 * 60 * 1000);
      newSchedulePreview = `${formatSchedule(start.toISOString(), end.toISOString())} (${rescheduleDuration} hr${rescheduleDuration > 1 ? 's' : ''})`;
    } catch {
      newSchedulePreview = `${rescheduleDate} at ${rescheduleStartTime}`;
    }
  }

  return (
    <main data-screen-label="Reservation Detail" style={{ padding: '26px 28px 40px' }}>
      <a href="#" onClick={(e) => { e.preventDefault(); router.push('/manage/reservations'); }} style={{ fontSize: '12px', color: 'var(--da-brand-dark)', fontFamily: 'var(--da-font-family)', fontWeight: 700 }}>&larr; Back to Reservations</a>
      
      {toastMessage && (
        <div
          data-testid="toast-notification"
          style={{
            margin: '14px 0 0',
            padding: '10px 14px',
            borderRadius: '8px',
            background: toastMessage.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${toastMessage.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            color: toastMessage.type === 'success' ? '#065F46' : '#991B1B',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '14px 0 20px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0, letterSpacing: '-0.02em' }}>{detail.referenceCode}</h1>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 800, padding: '4px 10px', borderRadius: '9999px', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', ...detail.statusStyle }}>
          <span aria-hidden="true" style={{ fontSize: '10px', lineHeight: 1 }}>{detail.mark}</span>{detail.status}
        </span>
      </div>

      {detail.pendingRelocationRequest && detail.pendingRelocationRequest.status === 'PENDING' && (
        <div
          data-testid="pending-relocation-request-banner"
          style={{
            background: '#FEFCE8',
            border: '1px solid #FEF08A',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: '240px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>⚠️</span>
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#854D0E' }}>
                  Pending Customer Relocation Request
                </h4>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', background: '#FEF08A', color: '#713F12' }}>
                  Awaiting Operator Approval
                </span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#713F12' }}>
                The customer has requested to relocate to <strong>{detail.pendingRelocationRequest.targetWorkspaceDisplayName}</strong>.
                {detail.pendingRelocationRequest.reason && <> Reason: <em>{detail.pendingRelocationRequest.reason}</em>.</>}
                {detail.pendingRelocationRequest.notes && <> Notes: &quot;{detail.pendingRelocationRequest.notes}&quot;.</>}
              </p>
              <div style={{ fontSize: '11px', color: '#A16207', marginTop: '4px' }}>
                Requested at: {formatTimelineDate(detail.pendingRelocationRequest.requestedAt)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                data-testid="approve-relocation-request-button"
                disabled={isDecidingRelocation}
                onClick={() => handleDecideRelocation('APPROVE')}
                style={{
                  background: '#16A34A',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isDecidingRelocation ? 'not-allowed' : 'pointer',
                }}
              >
                {isDecidingRelocation ? 'Processing...' : 'Approve Relocation'}
              </button>
              <button
                data-testid="decline-relocation-request-button"
                disabled={isDecidingRelocation}
                onClick={() => handleDecideRelocation('DECLINE')}
                style={{
                  background: '#DC2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isDecidingRelocation ? 'not-allowed' : 'pointer',
                }}
              >
                {isDecidingRelocation ? 'Processing...' : 'Decline Request'}
              </button>
            </div>
          </div>
          {relocationDecisionError && (
            <div style={{ color: '#DC2626', fontSize: '12px', fontWeight: 600 }}>
              {relocationDecisionError}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1.3, minWidth: '320px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 12px' }}>Reservation Information</h3>
          {detailFields.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--da-border-light)', fontSize: '13px' }}>
              <span style={{ color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>{f.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--da-text-primary)' }}>{f.value}</span>
            </div>
          ))}
          {detailActions.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '18px', flexWrap: 'wrap' }}>
              {detailActions.map((act, i) => (
                <button
                  key={i}
                  data-testid={act.testId}
                  onClick={act.onClick}
                  style={{ padding: '9px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', ...act.style }}
                >
                  {act.label}
                </button>
              ))}
            </div>
          )}
          {detail.paymentAttempts && detail.paymentAttempts.length > 0 && (
            <div style={{ marginTop: '20px', borderTop: '1px solid var(--da-border-light)', paddingTop: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 10px' }}>Payment History</h3>
              {detail.paymentAttempts.map((pa, i) => (
                <div key={pa.id || i} style={{ borderLeft: '3px solid var(--da-border)', padding: '8px 10px', marginBottom: '8px', background: '#F8FAFC', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--da-text-primary)' }}>
                    <span>{pa.channel} Attempt</span>
                    <span style={{ color: pa.status === 'APPROVED' ? 'var(--da-success)' : pa.status === 'EXPIRED' ? 'var(--da-text-secondary)' : pa.status === 'REJECTED' ? 'var(--da-danger)' : 'var(--da-brand-dark)' }}>{pa.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                      {pa.proofSubmittedAt ? `Proof uploaded: ${formatTimelineDate(pa.proofSubmittedAt)}` : 'No proof submitted'}
                      {pa.expiresAt ? ` • Expired: ${formatTimelineDate(pa.expiresAt)}` : ''}
                    </div>
                    {pa.id && (pa.proofSubmittedAt || pa.proofStoragePath) && (
                      <button
                        data-testid={`view-payment-proof-${pa.id}`}
                        onClick={() => handleOpenProofModal(pa.id)}
                        style={{
                          background: '#fff',
                          border: '1px solid var(--da-brand-dark)',
                          color: 'var(--da-brand-dark)',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: 'var(--da-font-family)',
                        }}
                      >
                        View Proof
                      </button>
                    )}
                  </div>
                  {pa.rejectionReason && (
                    <div style={{ fontSize: '11px', color: 'var(--da-danger)', marginTop: '4px', fontWeight: 600 }}>
                      Rejection reason: {pa.rejectionReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: '260px', background: '#fff', border: '1px solid var(--da-border)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '0 0 12px' }}>Candidates</h3>
          {detailCandidates.map((c, i) => (
            <div key={i} style={{ borderLeft: `3px solid ${c.color}`, padding: '8px 10px', marginBottom: '8px', background: '#F1F8F3', borderRadius: '6px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: c.color, fontFamily: 'var(--da-font-family)' }}>{c.tier}</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--da-text-primary)' }}>{c.name}</div>
            </div>
          ))}
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--da-text-primary)', margin: '20px 0 12px' }}>Timeline</h3>
          {detailTimeline.map((t, i) => {
            const isReentry = t.toLowerCase().includes("re-entered") || t.toLowerCase().includes("re-entry") || t.toLowerCase().includes("re-check-in");
            const isCancel = t.toLowerCase().includes("cancelled");
            const isReschedule = t.toLowerCase().includes("rescheduled");
            const isRelocate = t.toLowerCase().includes("relocated");
            return (
              <div
                key={i}
                style={{
                  fontSize: '12px',
                  color: isCancel ? 'var(--da-danger)' : isReschedule ? '#0369A1' : isRelocate ? '#0D9488' : isReentry ? '#0369A1' : 'var(--da-text-primary)',
                  fontWeight: isCancel || isReschedule || isRelocate || isReentry ? 600 : 400,
                  fontFamily: 'var(--da-font-family)',
                  padding: '6px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--da-border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isReentry && <span aria-hidden="true" style={{ fontSize: '11px', color: '#0284C7', fontWeight: 800 }}>↺</span>}
                {isCancel && <span aria-hidden="true" style={{ fontSize: '11px', color: 'var(--da-danger)', fontWeight: 800 }}>✕</span>}
                {isReschedule && <span aria-hidden="true" style={{ fontSize: '11px', color: '#0284C7', fontWeight: 800 }}>📅</span>}
                {isRelocate && <span aria-hidden="true" style={{ fontSize: '11px', color: '#0D9488', fontWeight: 800 }}>🔀</span>}
                <span>{t}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Relocate Spot Modal */}
      {showRelocateModal && (
        <div
          data-modal="relocate-booking-modal"
          data-testid="relocate-booking-modal"
          onClick={() => !isRelocating && setShowRelocateModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
              border: '1px solid var(--da-border)',
              boxSizing: 'border-box',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                  Relocate Spot
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', margin: 0 }}>
                  Relocate reservation <strong>#{detail.referenceCode}</strong> to an available spot (same template &amp; preserved schedule).
                </p>
              </div>
              <button
                data-testid="close-relocate-modal-x-button"
                onClick={() => !isRelocating && setShowRelocateModal(false)}
                aria-label="Close modal"
                disabled={isRelocating}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--da-text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {relocateError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px' }}>
                {relocateError}
              </div>
            )}

            {(() => {
              const nowMs = Date.now();
              const candStartMs = detail.assignedCandidate?.startAt ? new Date(detail.assignedCandidate.startAt).getTime() : detail.startAt ? new Date(detail.startAt).getTime() : 0;
              const candEndMs = detail.assignedCandidate?.endAt ? new Date(detail.assignedCandidate.endAt).getTime() : detail.endAt ? new Date(detail.endAt).getTime() : 0;
              const isInSession = candStartMs > 0 && candEndMs > 0 && nowMs >= candStartMs && nowMs < candEndMs && (detail.reservationStatus === 'CONFIRMED' || detail.reservationStatus === 'CHECKED_IN');
              if (!isInSession) return null;

              const remainingMinutes = Math.max(0, Math.round((candEndMs - nowMs) / 60000));
              const remainingHours = Math.floor(remainingMinutes / 60);
              const remMins = remainingMinutes % 60;
              const remainingTimeText = remainingHours > 0
                ? `${remainingHours} hour${remainingHours > 1 ? 's' : ''}${remMins > 0 ? ` ${remMins} min${remMins > 1 ? 's' : ''}` : ''}`
                : `${remMins} min${remMins > 1 ? 's' : ''}`;
              const endAtIso = detail.assignedCandidate?.endAt || detail.endAt;
              let endTimeFormatted = '';
              if (endAtIso) {
                try {
                  endTimeFormatted = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Manila',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  }).format(new Date(endAtIso));
                } catch {
                  endTimeFormatted = endAtIso;
                }
              }

              return (
                <div
                  data-testid="in-session-relocation-notice"
                  style={{
                    background: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                    color: '#166534',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    marginBottom: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span>⚡</span>
                  <span>Session in progress. Reallocating for remaining time: {remainingTimeText} (until {endTimeFormatted}).</span>
                </div>
              );
            })()}

            <div style={{ background: '#F8FAFC', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Customer:</span>
                <span style={{ fontWeight: 700 }}>{detail.customerName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Current Spot:</span>
                <span style={{ fontWeight: 700 }}>{allocatedSpotName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Workspace Template:</span>
                <span style={{ fontWeight: 700 }}>{detail.assignedCandidate?.workspaceTemplateName || "Standard"}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Preserved Schedule:</span>
                <span style={{ fontWeight: 700 }}>{detail.schedule} ({detail.duration})</span>
              </div>
            </div>

            {isLoadingRelocationSpots ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px' }}>
                Checking available sibling spots for this time slot...
              </div>
            ) : relocationSpots.length === 0 ? (
              <div
                data-testid="no-relocation-spots-alert"
                style={{
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  marginBottom: '16px',
                  fontSize: '12px',
                  color: '#991B1B',
                  lineHeight: 1.4,
                }}
              >
                ⚠️ <strong>No available spots of the same template for this time slot.</strong> All sibling spots have overlapping bookings or are under maintenance. Please reschedule or contact the customer.
              </div>
            ) : (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                  Target Available Spot *
                </label>
                <select
                  data-testid="relocate-spot-select"
                  value={selectedRelocationSpotId}
                  onChange={(e) => setSelectedRelocationSpotId(e.target.value)}
                  disabled={isRelocating}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--da-border)',
                    fontSize: '13px',
                    color: 'var(--da-text-primary)',
                    backgroundColor: '#fff',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                >
                  {relocationSpots.map((spot) => (
                    <option key={spot.id} value={spot.id}>
                      {spot.displayName || spot.instanceCode} {spot.floorName ? `· ${spot.floorName}` : ''} (Available)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                Relocation Reason *
              </label>
              <select
                data-testid="relocation-reason-select"
                value={relocationReason}
                onChange={(e) => setRelocationReason(e.target.value)}
                disabled={isRelocating}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border)',
                  fontSize: '13px',
                  color: 'var(--da-text-primary)',
                  backgroundColor: '#fff',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              >
                {RELOCATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                Additional Notes (Optional)
              </label>
              <textarea
                data-testid="relocation-notes-input"
                value={relocationNotes}
                onChange={(e) => setRelocationNotes(e.target.value)}
                placeholder="Add any context regarding the spot issue or customer notification..."
                disabled={isRelocating}
                rows={2}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border)',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--da-font-family)',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                data-testid="relocate-modal-cancel-button"
                onClick={() => setShowRelocateModal(false)}
                disabled={isRelocating}
                style={{
                  padding: '9px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'transparent',
                  color: 'var(--da-text-primary)',
                  border: '1px solid var(--da-border)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Cancel
              </button>
              <button
                data-testid="confirm-relocate-button"
                onClick={handleConfirmRelocation}
                disabled={isRelocating || isLoadingRelocationSpots || relocationSpots.length === 0 || !selectedRelocationSpotId}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: (isRelocating || isLoadingRelocationSpots || relocationSpots.length === 0 || !selectedRelocationSpotId) ? 'not-allowed' : 'pointer',
                  background: '#0D9488',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                  opacity: (isRelocating || isLoadingRelocationSpots || relocationSpots.length === 0 || !selectedRelocationSpotId) ? 0.6 : 1,
                }}
              >
                {isRelocating ? 'Relocating...' : 'Confirm Relocation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div
          data-modal="cancel-booking-modal"
          data-testid="cancel-booking-modal"
          onClick={() => !isCancelling && setShowCancelModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
              border: '1px solid var(--da-border)',
              boxSizing: 'border-box',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-danger)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                  Cancel Reservation
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', margin: 0 }}>
                  Are you sure you want to cancel reservation <strong>#{detail.referenceCode}</strong>?
                </p>
              </div>
              <button
                data-testid="close-cancel-modal-x-button"
                onClick={() => !isCancelling && setShowCancelModal(false)}
                aria-label="Close modal"
                disabled={isCancelling}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--da-text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {cancelError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px' }}>
                {cancelError}
              </div>
            )}

            <div style={{ background: '#F8FAFC', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Customer:</span>
                <span style={{ fontWeight: 700 }}>{detail.customerName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Allocated Spot:</span>
                <span style={{ fontWeight: 700 }}>{allocatedSpotName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Scheduled Time:</span>
                <span style={{ fontWeight: 700 }}>{detail.schedule}</span>
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                Cancellation Reason *
              </label>
              <select
                data-testid="cancellation-reason-select"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                disabled={isCancelling}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border)',
                  fontSize: '13px',
                  color: 'var(--da-text-primary)',
                  backgroundColor: '#fff',
                  outline: 'none',
                }}
              >
                {CANCELLATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                Additional Notes (Optional)
              </label>
              <textarea
                data-testid="cancellation-notes-input"
                value={cancelNotes}
                onChange={(e) => setCancelNotes(e.target.value)}
                placeholder="Add any internal or customer-facing notes..."
                disabled={isCancelling}
                rows={3}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border)',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--da-font-family)',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                data-testid="cancel-modal-dismiss-button"
                onClick={() => setShowCancelModal(false)}
                disabled={isCancelling}
                style={{
                  padding: '9px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'transparent',
                  color: 'var(--da-text-primary)',
                  border: '1px solid var(--da-border)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Keep Reservation
              </button>
              <button
                data-testid="confirm-cancellation-button"
                onClick={handleConfirmCancellation}
                disabled={isCancelling}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isCancelling ? 'not-allowed' : 'pointer',
                  background: 'var(--da-danger)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                  opacity: isCancelling ? 0.7 : 1,
                }}
              >
                {isCancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {showRescheduleModal && (
        <div
          data-modal="reschedule-booking-modal"
          data-testid="reschedule-booking-modal"
          onClick={() => !isRescheduling && setShowRescheduleModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
              border: '1px solid var(--da-border)',
              boxSizing: 'border-box',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                  Reschedule Reservation
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--da-text-secondary)', margin: 0 }}>
                  Adjust booking date and time for <strong>#{detail.referenceCode}</strong>
                </p>
              </div>
              <button
                data-testid="close-reschedule-modal-x-button"
                onClick={() => !isRescheduling && setShowRescheduleModal(false)}
                aria-label="Close modal"
                disabled={isRescheduling}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--da-text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {rescheduleError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px' }}>
                {rescheduleError}
              </div>
            )}

            <div style={{ background: '#F8FAFC', border: '1px solid var(--da-border)', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Customer:</span>
                <span style={{ fontWeight: 700 }}>{detail.customerName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Allocated Spot:</span>
                <span style={{ fontWeight: 700 }}>{allocatedSpotName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--da-text-secondary)' }}>Current Schedule:</span>
                <span style={{ fontWeight: 700 }}>{detail.schedule} ({detail.duration})</span>
              </div>
            </div>

            {/* Spot Selection (Same Template Tier) */}
            {sameTemplateInstances.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                  Workspace Spot {detail.assignedCandidate?.workspaceTemplateName ? `(${detail.assignedCandidate.workspaceTemplateName})` : ''}
                </label>
                <select
                  data-testid="reschedule-spot-select"
                  value={selectedSpotId}
                  onChange={(e) => setSelectedSpotId(e.target.value)}
                  disabled={isRescheduling}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--da-border)',
                    fontSize: '13px',
                    color: 'var(--da-text-primary)',
                    backgroundColor: '#fff',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                >
                  {sameTemplateInstances.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.displayName || inst.instanceCode} {inst.floor?.name ? `· ${inst.floor.name}` : ''} {inst.id === detail.assignedCandidate?.workspaceInstanceId ? '(Current Spot)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                  New Date *
                </label>
                <input
                  type="date"
                  data-testid="reschedule-date-input"
                  min={getTodayManila()}
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  disabled={isRescheduling}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--da-border)',
                    fontSize: '13px',
                    color: 'var(--da-text-primary)',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)', marginBottom: '6px' }}>
                  Duration (Locked)
                </label>
                <div
                  data-testid="reschedule-duration-locked"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--da-border)',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--da-text-primary)',
                    backgroundColor: '#F1F5F9',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{detail.duration || `${rescheduleDuration} hour${rescheduleDuration > 1 ? 's' : ''}`}</span>
                  <span style={{ fontSize: '10px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Original
                  </span>
                </div>
              </div>
            </div>

            {/* Time Slot Selection (Booked/Past times are non-clickable) */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--da-text-primary)' }}>
                  Start Time *
                </label>
                <span style={{ fontSize: '11px', color: 'var(--da-text-secondary)' }}>
                  {rescheduleStartTime ? `Selected: ${formatTime12Hour(rescheduleStartTime)}` : 'Select an available slot'}
                </span>
              </div>

              {/* Interactive Time Slot Pills Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                  gap: '6px',
                  maxHeight: '150px',
                  overflowY: 'auto',
                  padding: '6px',
                  background: '#F8FAFC',
                  borderRadius: '8px',
                  border: '1px solid var(--da-border)',
                }}
              >
                {(availabilityResult?.slots || TIME_OPTIONS.map((t) => ({ startTime: t, isAvailable: true }))).map((slot: any) => {
                  const isSelected = rescheduleStartTime === slot.startTime;
                  const slotDateUtc = zonedDateTimeToUtc(rescheduleDate || getTodayManila(), slot.startTime, "Asia/Manila");
                  const isPast = slotDateUtc.getTime() <= Date.now();
                  const isAvail = Boolean(slot.isAvailable) && !isPast;
                  const reason = isPast ? 'Past' : (slot.reason || 'Booked');

                  return (
                    <button
                      key={slot.startTime}
                      type="button"
                      data-testid={`reschedule-time-slot-${slot.startTime}`}
                      disabled={!isAvail || isRescheduling}
                      onClick={() => {
                        if (isAvail) {
                          setRescheduleStartTime(slot.startTime);
                        }
                      }}
                      title={isPast ? 'This time slot has already passed' : !slot.isAvailable ? 'This time slot is already booked' : `Select ${formatTime12Hour(slot.startTime)}`}
                      style={{
                        padding: '7px 4px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: isSelected ? 700 : 500,
                        textAlign: 'center',
                        transition: 'all 0.15s ease',
                        border: isSelected
                          ? '2px solid var(--da-brand-dark)'
                          : isAvail
                          ? '1px solid var(--da-border)'
                          : '1px dashed #CBD5E1',
                        backgroundColor: isSelected
                          ? '#D1FAE5'
                          : isAvail
                          ? '#FFFFFF'
                          : '#F1F5F9',
                        color: isSelected
                          ? 'var(--da-brand-dark)'
                          : isAvail
                          ? 'var(--da-text-primary)'
                          : '#94A3B8',
                        cursor: isAvail ? 'pointer' : 'not-allowed',
                        pointerEvents: isAvail ? 'auto' : 'none',
                        opacity: isAvail ? 1 : 0.45,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2px',
                        userSelect: 'none',
                      }}
                    >
                      <span style={{ textDecoration: isAvail ? 'none' : 'line-through' }}>
                        {formatTime12Hour(slot.startTime)}
                      </span>
                      {!isAvail && (
                        <span style={{ fontSize: '8px', fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {reason}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Accessible / test fallback select */}
              <select
                data-testid="reschedule-time-select"
                value={rescheduleStartTime}
                onChange={(e) => setRescheduleStartTime(e.target.value)}
                disabled={isRescheduling}
                style={{ display: 'none' }}
              >
                <option value="">Select Time</option>
                {TIME_OPTIONS.map((t) => {
                  const slot = availabilityResult?.slots?.find((s) => s.startTime === t);
                  const slotDateUtc = zonedDateTimeToUtc(rescheduleDate || getTodayManila(), t, "Asia/Manila");
                  const isPast = slotDateUtc.getTime() <= Date.now();
                  const isAvail = Boolean(slot ? slot.isAvailable : true) && !isPast;
                  const reasonLabel = isPast ? '(Past)' : (!isAvail ? '(Booked)' : '');
                  return (
                    <option key={t} value={t} disabled={!isAvail}>
                      {t} {reasonLabel}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Availability Status Indicator */}
            <div
              data-testid="reschedule-availability-indicator"
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: isCheckingAvailability
                  ? '#F8FAFC'
                  : availabilityResult?.available === false
                  ? '#FEF2F2'
                  : '#ECFDF5',
                border: `1px solid ${
                  isCheckingAvailability
                    ? 'var(--da-border)'
                    : availabilityResult?.available === false
                    ? '#FECACA'
                    : '#A7F3D0'
                }`,
                color: isCheckingAvailability
                  ? 'var(--da-text-secondary)'
                  : availabilityResult?.available === false
                  ? '#991B1B'
                  : '#065F46',
              }}
            >
              {isCheckingAvailability ? (
                <span>Checking slot availability...</span>
              ) : availabilityResult?.available === false ? (
                <span>⚠️ Slot unavailable: {availabilityResult.reason || 'Spot is occupied during this time'}</span>
              ) : (
                <span>✓ Spot is available for this time window</span>
              )}
            </div>

            {/* Summary comparison box */}
            <div style={{ background: '#F1F8F3', borderLeft: '3px solid var(--da-brand-dark)', borderRadius: '6px', padding: '10px 12px', marginBottom: '20px', fontSize: '12px' }}>
              <div style={{ fontWeight: 700, color: 'var(--da-brand-dark)', marginBottom: '4px' }}>Schedule Update Summary</div>
              <div style={{ color: 'var(--da-text-secondary)' }}>
                <span style={{ textDecoration: 'line-through' }}>{detail.schedule}</span> &rarr; <strong style={{ color: 'var(--da-text-primary)' }}>{newSchedulePreview}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                data-testid="reschedule-modal-cancel-button"
                onClick={() => setShowRescheduleModal(false)}
                disabled={isRescheduling}
                style={{
                  padding: '9px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'transparent',
                  color: 'var(--da-text-primary)',
                  border: '1px solid var(--da-border)',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Cancel
              </button>
              <button
                data-testid="confirm-reschedule-button"
                onClick={handleConfirmReschedule}
                disabled={isRescheduling || isCheckingAvailability || availabilityResult?.available === false}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: (isRescheduling || isCheckingAvailability || availabilityResult?.available === false) ? 'not-allowed' : 'pointer',
                  background: 'var(--da-brand-dark)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                  opacity: (isRescheduling || isCheckingAvailability || availabilityResult?.available === false) ? 0.6 : 1,
                }}
              >
                {isRescheduling ? 'Rescheduling...' : 'Confirm Reschedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Booking QR Code Modal */}
      {showQrModal && detail && (
        <div
          data-modal="booking-qr-modal"
          data-testid="booking-qr-modal"
          onClick={() => setShowQrModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '420px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
              border: '1px solid var(--da-border)',
              boxSizing: 'border-box',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
                  Booking QR Code
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--da-text-secondary)', margin: 0 }}>
                  Scan at front desk or kiosk for check-in / re-entry
                </p>
              </div>
              <button
                data-testid="close-qr-modal-x-button"
                onClick={() => setShowQrModal(false)}
                aria-label="Close modal"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--da-text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px dashed var(--da-border)',
                margin: '16px 0',
              }}
            >
              <QRCodeSVG
                value={getBookingQrValue(detail)}
                size={200}
                level="H"
              />
              <div style={{ marginTop: '14px', textAlign: 'center' }}>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    fontWeight: 800,
                    color: 'var(--da-brand-dark)',
                    letterSpacing: '0.05em',
                  }}
                >
                  {detail.referenceCode}
                </span>
                <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginTop: '2px' }}>
                  {detail.customerName}
                </div>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--da-text-secondary)', marginBottom: '18px', background: '#F1F8F3', padding: '10px 12px', borderRadius: '8px', borderLeft: '3px solid var(--da-brand-dark)' }}>
              <div style={{ fontWeight: 700, color: 'var(--da-brand-dark)' }}>Schedule</div>
              <div>{detail.schedule} ({detail.duration})</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                data-testid="close-qr-modal-button"
                onClick={() => setShowQrModal(false)}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'var(--da-brand-dark)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Payment Proof Viewer Modal with MF-114 Zoom and Pan */}
      {viewingProofAttemptId && (
        <div
          data-testid="proof-viewer-modal"
          onClick={() => setViewingProofAttemptId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '560px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              border: '1px solid var(--da-border)',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: 0 }}>
                Payment Proof Inspection
              </h3>
              <button
                data-testid="close-proof-modal-button"
                onClick={() => setViewingProofAttemptId(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: 'var(--da-text-secondary)',
                }}
              >
                ✕
              </button>
            </div>
            <ProofImageViewer proofUrl={viewingProofUrl} loading={loadingProofUrl} height="360px" alt="Payment proof submission" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button
                onClick={() => setViewingProofAttemptId(null)}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'var(--da-brand-dark)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'var(--da-font-family)',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <ExtendReservationModal
          isOpen={showExtendModal}
          onClose={() => setShowExtendModal(false)}
          onSuccess={() => {
            fetchDetail();
            setToastMessage({
              type: 'success',
              text: 'Reservation time extended successfully.',
            });
          }}
          reservationId={detail.id}
          referenceCode={detail.referenceCode}
          customerName={detail.customerName}
          spotDisplayName={detail.assignedCandidate?.workspaceDisplayName || detail.assignedCandidate?.workspaceInstanceCode || 'Spot'}
          templateName={detail.assignedCandidate?.workspaceTemplateName || undefined}
          currentSchedule={detail.schedule}
          currentEndAt={detail.endAt || undefined}
          hourlyRate={detail.rateSnapshot || 150}
          apiPrefix="/api/admin/reservations"
          actorRole="ADMIN"
        />
      )}
    </main>
  );
}

