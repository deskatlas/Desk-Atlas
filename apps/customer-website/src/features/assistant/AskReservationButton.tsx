'use client';

// MS78-R04 / MS97-R01: Compact Prop and Styling on AskReservationButton
export interface AskReservationButtonProps {
  reservationId: string;
  size?: 'default' | 'compact';
  label?: string;
  className?: string;
}

export function AskReservationButton({
  reservationId,
  size = 'default',
  label,
  className,
}: AskReservationButtonProps) {
  if (process.env.NEXT_PUBLIC_CUSTOMER_ASSISTANT_ENABLED !== 'true') return null;

  const isCompact = size === 'compact';
  const displayLabel = label || (isCompact ? 'Ask Assistant' : 'Ask about this reservation');

  const baseClasses = isCompact
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors'
    : 'da-secondary-button text-xs';

  return (
    <button
      type="button"
      className={`${baseClasses} ${className || ''}`.trim()}
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent('deskatlas:assistant:reservation', {
            detail: { reservationId },
          })
        );
      }}
      data-testid={`ask-assistant-btn-${reservationId}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      <span>{displayLabel}</span>
    </button>
  );
}
