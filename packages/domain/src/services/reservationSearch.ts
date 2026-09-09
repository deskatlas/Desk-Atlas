export interface ReservationSearchTarget {
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  referenceCode?: string | null;
  reservationId?: string | null;
  id?: string | null;
}

/**
 * Evaluates whether a reservation record matches a given search query.
 * Matches against:
 * - Guest first name (partial, case-insensitive)
 * - Guest last name (partial, case-insensitive)
 * - Guest full name (partial, case-insensitive, e.g. "John D" matches "John Doe")
 * - Reservation reference ID / reference code (exact or partial, case-insensitive)
 * - Reservation UUID / ID (exact or partial, case-insensitive)
 * Empty or whitespace-only query matches all records.
 */
export function matchesReservationSearch(
  item: ReservationSearchTarget,
  query?: string | null
): boolean {
  if (!query || query.trim() === "") {
    return true;
  }

  const q = query.trim().toLowerCase();

  const firstName = (item.customerFirstName ?? "").toLowerCase();
  const lastName = (item.customerLastName ?? "").toLowerCase();
  const fullName = (
    item.customerName ??
    `${item.customerFirstName ?? ""} ${item.customerLastName ?? ""}`.trim()
  ).toLowerCase();
  const refCode = (item.referenceCode ?? "").toLowerCase();
  const id = (item.reservationId ?? item.id ?? "").toLowerCase();

  return (
    firstName.includes(q) ||
    lastName.includes(q) ||
    fullName.includes(q) ||
    refCode.includes(q) ||
    id.includes(q)
  );
}

/**
 * Filters an array of reservation records by search query in real time.
 */
export function filterReservationsBySearch<T extends ReservationSearchTarget>(
  items: T[],
  query?: string | null
): T[] {
  if (!query || query.trim() === "") {
    return items;
  }
  return items.filter((item) => matchesReservationSearch(item, query));
}
