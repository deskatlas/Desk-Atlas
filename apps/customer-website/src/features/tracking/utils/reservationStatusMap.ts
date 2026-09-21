export type ReservationDisplayStatus =
  | "PENDING_PAYMENT"
  | "PAYMENT_UNDER_REVIEW"
  | "CONFIRMED"
  | "NEEDS_MANUAL_RESOLUTION"
  | "CANCELLED"
  | "EXPIRED"
  | "COMPLETED"
  | "REJECTED";

export interface StatusPresentation {
  label: string;
  badgeClass: string;
}

export function mapReservationStatusDisplay(status: string, paymentStatus?: string | null): StatusPresentation {
  const normalized = status?.toUpperCase();
  const normalizedPayment = paymentStatus?.toUpperCase();

  if (normalized === "REJECTED" || normalizedPayment === "REJECTED") {
    return {
      label: "Rejected",
      badgeClass: "bg-red-100 text-red-700",
    };
  }

  switch (normalized) {
    case "EXPIRED":
      return {
        label: "Expired",
        badgeClass: "bg-gray-100 text-gray-700 border border-gray-300",
      };
    case "PENDING_PAYMENT":
      return {
        label: "Pending Payment",
        badgeClass: "bg-amber-100 text-amber-800",
      };
    case "PAYMENT_UNDER_REVIEW":
    case "PENDING_COUNTER_CONFIRMATION":
      return {
        label: "Payment Under Review",
        badgeClass: "bg-blue-100 text-blue-800",
      };
    case "CONFIRMED":
      return {
        label: "Confirmed",
        badgeClass: "bg-[var(--da-info)] text-[var(--da-primary)]",
      };
    case "CHECKED_IN":
      return {
        label: "Checked In",
        badgeClass: "bg-green-100 text-green-800",
      };
    case "COMPLETED":
      return {
        label: "Completed",
        badgeClass: "bg-gray-100 text-gray-700",
      };
    case "CANCELLED":
      return {
        label: "Cancelled",
        badgeClass: "bg-red-100 text-red-700",
      };
    case "NEEDS_MANUAL_RESOLUTION":
      return {
        label: "Needs Manual Resolution",
        badgeClass: "bg-yellow-100 text-yellow-800",
      };
    default:
      return {
        label: status || "Unknown",
        badgeClass: "bg-gray-100 text-gray-700",
      };
  }
}
