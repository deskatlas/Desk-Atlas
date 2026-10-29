"use client";

import { useEffect, useState } from "react";
import { RentalInstructionsCard } from "./RentalInstructionsCard";
import { RentalServiceCard, type RentalServiceItem } from "./RentalServiceCard";
import { OneTimeServiceCard, type OneTimeServiceItem } from "./OneTimeServiceCard";

interface ServicesResponse {
  rentals?: RentalServiceItem[];
  oneTimeServices?: OneTimeServiceItem[];
  data?: {
    rentals?: RentalServiceItem[];
    oneTimeServices?: OneTimeServiceItem[];
  };
}

interface CustomerServicesDashboardProps {
  initialRentals?: RentalServiceItem[];
  initialOneTimeServices?: OneTimeServiceItem[];
}

export function CustomerServicesDashboard({
  initialRentals,
  initialOneTimeServices,
}: CustomerServicesDashboardProps = {}) {
  const [activeTab, setActiveTab] = useState<"rentals" | "one_time">("rentals");
  const [rentals, setRentals] = useState<RentalServiceItem[]>(initialRentals || []);
  const [oneTimeServices, setOneTimeServices] = useState<OneTimeServiceItem[]>(
    initialOneTimeServices || []
  );
  const [loading, setLoading] = useState(!initialRentals && !initialOneTimeServices);
  const [error, setError] = useState<string | null>(null);

  const loadServices = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/services");
      if (!res.ok) {
        throw new Error(`Failed to load services (${res.status})`);
      }
      const json = (await res.json()) as ServicesResponse;
      const loadedRentals = json.rentals || json.data?.rentals || [];
      const loadedOneTime = json.oneTimeServices || json.data?.oneTimeServices || [];
      setRentals(loadedRentals);
      setOneTimeServices(loadedOneTime);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load services";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialRentals && !initialOneTimeServices) {
      void loadServices();
    }
  }, [initialRentals, initialOneTimeServices]);

  const handleRentClick = () => {
    const el = document.getElementById("how-to-rent");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-[var(--da-primary)]");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-[var(--da-primary)]");
      }, 2000);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-12" data-testid="customer-services-dashboard">
      {/* Hero Section */}
      <div className="mb-10">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--da-primary)]">
          On-Site Amenities
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-[-0.03em] text-[var(--da-brand-dark)]">
          Workspace Amenities & Additional Services
        </h1>
        <p className="mt-3 max-w-2xl text-base text-[var(--da-text-secondary)]">
          Enhance your productivity with high-performance rental equipment and on-demand office services available on-site.
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-8 flex items-center gap-3 border-b border-[var(--da-border)] pb-4">
        <button
          type="button"
          onClick={() => setActiveTab("rentals")}
          data-testid="tab-rentals"
          className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all ${
            activeTab === "rentals"
              ? "bg-[var(--da-brand-dark)] text-white shadow-sm"
              : "bg-white text-[var(--da-text-secondary)] hover:text-[var(--da-brand-dark)] border border-[var(--da-border)]"
          }`}
        >
          Equipment for Rent ({rentals.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("one_time")}
          data-testid="tab-one-time"
          className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all ${
            activeTab === "one_time"
              ? "bg-[var(--da-brand-dark)] text-white shadow-sm"
              : "bg-white text-[var(--da-text-secondary)] hover:text-[var(--da-brand-dark)] border border-[var(--da-border)]"
          }`}
        >
          Business & Print Services ({oneTimeServices.length})
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700" data-testid="services-error-state">
          <p className="text-sm font-semibold">{error}</p>
          <button
            type="button"
            onClick={() => void loadServices()}
            className="da-secondary-button mt-4 text-xs font-bold"
          >
            Retry Loading
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="py-20 text-center" data-testid="services-loading-state">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[var(--da-primary)] border-r-transparent" />
          <p className="mt-4 text-xs font-semibold text-[var(--da-text-secondary)]">
            Loading workspace amenities and rental catalog...
          </p>
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <>
          {activeTab === "rentals" && (
            <section data-testid="rentals-section">
              {/* How to rent guidance card */}
              <RentalInstructionsCard />

              {rentals.length === 0 ? (
                <div
                  data-testid="no-rentals-empty-state"
                  className="rounded-2xl border border-dashed border-[var(--da-border)] bg-white p-12 text-center"
                >
                  <p className="text-sm font-bold text-[var(--da-brand-dark)]">
                    No rental equipment currently cataloged
                  </p>
                  <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                    Check back soon or inquire directly with front desk staff for peripheral availability.
                  </p>
                </div>
              ) : (
                <div
                  data-testid="rentals-grid"
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
                >
                  {rentals.map((item) => (
                    <RentalServiceCard
                      key={item.id}
                      service={item}
                      onRentClick={handleRentClick}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === "one_time" && (
            <section data-testid="one-time-section">
              {oneTimeServices.length === 0 ? (
                <div
                  data-testid="no-one-time-empty-state"
                  className="rounded-2xl border border-dashed border-[var(--da-border)] bg-white p-12 text-center"
                >
                  <p className="text-sm font-bold text-[var(--da-brand-dark)]">
                    No business services currently cataloged
                  </p>
                  <p className="mt-1 text-xs text-[var(--da-text-secondary)]">
                    Printing, scanning, and locker services can be requested directly at the reception counter.
                  </p>
                </div>
              ) : (
                <div
                  data-testid="one-time-grid"
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
                >
                  {oneTimeServices.map((item) => (
                    <OneTimeServiceCard key={item.id} service={item} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

