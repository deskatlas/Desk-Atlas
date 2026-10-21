'use client';

// MS78-R04: an ID is an untrusted pointer; the gateway still verifies purpose and ownership.
export function AskReservationButton({ reservationId }: { reservationId: string }) {
  if (process.env.NEXT_PUBLIC_CUSTOMER_ASSISTANT_ENABLED !== 'true') return null;
  return <button type="button" className="da-secondary-button text-xs" onClick={() => {
    window.dispatchEvent(new CustomEvent('deskatlas:assistant:reservation', { detail: { reservationId } }));
  }}>Ask about this reservation</button>;
}
