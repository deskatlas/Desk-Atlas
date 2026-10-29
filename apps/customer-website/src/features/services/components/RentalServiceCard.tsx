"use client";

export interface RentalServiceItem {
  id: string;
  name: string;
  description: string;
  hourlyRate: number | null;
  dailyRate: number | null;
  totalInventory: number;
  availableInventory: number;
  inStock?: boolean;
}

interface RentalServiceCardProps {
  service: RentalServiceItem;
  onRentClick?: () => void;
}

export function RentalServiceCard({ service, onRentClick }: RentalServiceCardProps) {
  const isAvailable = service.availableInventory > 0;

  return (
    <article
      data-testid={`rental-card-${service.id}`}
      className="flex flex-col justify-between rounded-2xl border border-[var(--da-border)] bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
    >
      <div>
        {/* Availability Badge */}
        <div className="flex items-center justify-between gap-2 mb-3">
          {isAvailable ? (
            <span
              data-testid="rental-stock-badge"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Available: {service.availableInventory} in stock
            </span>
          ) : (
            <span
              data-testid="rental-stock-badge"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200"
            >
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Currently Out of Stock
            </span>
          )}
          <span className="text-[11px] font-medium text-[var(--da-text-secondary)]">
            Total units: {service.totalInventory}
          </span>
        </div>

        {/* Item Name */}
        <h3 className="text-lg font-bold text-[var(--da-brand-dark)]">
          {service.name}
        </h3>

        {/* Item Description */}
        <p className="mt-2 text-xs leading-relaxed text-[var(--da-text-secondary)]">
          {service.description || "High-performance workspace peripheral available for rental."}
        </p>

        {/* Pricing Badges */}
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="rental-pricing-block">
          {service.hourlyRate !== null && service.hourlyRate !== undefined && (
            <span
              data-testid="hourly-rate-badge"
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-[var(--da-primary)]/10 text-[var(--da-primary)] border border-[var(--da-primary)]/20"
            >
              PHP {Number(service.hourlyRate).toFixed(2)} / hr
            </span>
          )}
          {service.dailyRate !== null && service.dailyRate !== undefined && Number(service.dailyRate) > 0 && (
            <span
              data-testid="daily-rate-badge"
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200"
            >
              PHP {Number(service.dailyRate).toFixed(2)} / day (Full Day Pass)
            </span>
          )}
        </div>
      </div>

      {/* Rental Action Button */}
      <div className="mt-6 pt-4 border-t border-[var(--da-border-light)]">
        <button
          type="button"
          onClick={onRentClick}
          data-testid="rent-at-front-desk-button"
          className="da-primary-button w-full justify-center text-xs font-bold py-2.5"
        >
          Rent at Front Desk
        </button>
      </div>
    </article>
  );
}

