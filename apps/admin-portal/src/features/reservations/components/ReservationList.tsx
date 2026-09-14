"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearch } from '@deskatlas/ui';
import {
  filterReservationsBySearch,
  filterReservations,
  countActiveFilters,
  generateReservationsCsv,
  generateReservationsCsvFilename,
  type AdminReservationFilter,
  type AdminReservationSummary,
  type AdminReservationAdvancedFilters,
} from '@deskatlas/domain';
import { ReservationFilterModal } from './ReservationFilterModal';

export function ReservationList() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<AdminReservationFilter>('active');
  const [reservations, setReservations] = useState<AdminReservationSummary[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);
  const [advancedFilters, setAdvancedFilters] = useState<AdminReservationAdvancedFilters>({});
  const [exporting, setExporting] = useState<boolean>(false);
  const { searchQuery } = useSearch();

  const activeFilterCount = countActiveFilters(advancedFilters);

  const searchFiltered = filterReservationsBySearch(reservations, searchQuery);
  const displayedReservations = filterReservations(searchFiltered, advancedFilters);

  // Extract unique available template names from loaded reservations
  const availableTemplates = Array.from(
    new Set(
      reservations
        .map((r) => r.workspaceTemplateName)
        .filter((t): t is string => Boolean(t && t.trim() !== ""))
    )
  );

  useEffect(() => {
    let isCancelled = false;

    async function loadReservations() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/reservations?filter=${activeFilter}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`Failed to load reservations (${response.status})`);
        }
        const data = await response.json();
        if (!isCancelled) {
          setReservations(data.reservations ?? []);
          setTotalCount(data.total ?? 0);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err?.message ?? 'Failed to load reservations');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadReservations();
    const interval = setInterval(loadReservations, 15000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [activeFilter]);

  const handleExport = () => {
    try {
      setExporting(true);
      const csv = generateReservationsCsv(displayedReservations);
      const filename = generateReservationsCsvFilename();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const resFilters: Array<{ label: string; filter: AdminReservationFilter }> = [
    { label: 'Active', filter: 'active' },
    { label: 'All', filter: 'all' },
    { label: 'Checked In', filter: 'checked_in' },
    { label: 'Upcoming', filter: 'upcoming' },
    { label: 'Awaiting Proof', filter: 'awaiting_proof' },
    { label: 'Expired', filter: 'expired' },
    { label: 'Rejected', filter: 'rejected' },
  ];

  const pages = [
    { label: '1', style: { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' } },
  ];

  return (
    <main data-screen-label="Reservations" style={{ padding: '26px 28px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--da-brand-dark)', margin: '0 0 3px', letterSpacing: '-0.02em' }}>Reservations</h1>
          <div style={{ fontSize: '13px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>All bookings across floors and schedules</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setIsFilterModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              border: activeFilterCount > 0 ? '1.5px solid var(--da-brand-dark)' : '1px solid var(--da-border)',
              background: activeFilterCount > 0 ? '#ECFDF5' : '#fff',
              borderRadius: '9px',
              padding: '9px 14px',
              fontSize: '12px',
              fontWeight: 700,
              color: activeFilterCount > 0 ? 'var(--da-brand-dark)' : 'var(--da-text-primary)',
              cursor: 'pointer',
              fontFamily: 'var(--da-font-family)',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ width: '11px', height: '11px', border: `2px solid ${activeFilterCount > 0 ? 'var(--da-brand-dark)' : 'var(--da-text-secondary)'}`, borderRadius: '2px' }}></div>
            Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || displayedReservations.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              background: 'linear-gradient(0deg, var(--da-brand-dark) 70%, #154A32)',
              color: '#fff',
              border: 'none',
              borderRadius: '9px',
              padding: '9px 16px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: exporting || displayedReservations.length === 0 ? 'not-allowed' : 'pointer',
              opacity: exporting || displayedReservations.length === 0 ? 0.7 : 1,
              boxShadow: '0 4px 10px 1px rgba(12,59,39,.16)',
            }}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--da-border)', borderRadius: '14px', boxShadow: 'var(--da-shadow-sm)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--da-border-light)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontSize: '19px', fontWeight: 800, color: 'var(--da-brand-dark)' }}>{displayedReservations.length}</span>
            <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
              reservations {activeFilterCount > 0 || searchQuery.trim() ? `(filtered from ${totalCount})` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {resFilters.map((f, i) => {
              const isActive = activeFilter === f.filter;
              const filterStyle = isActive
                ? { background: 'var(--da-brand-dark)', color: '#fff', border: 'none' }
                : { background: 'transparent', color: 'var(--da-text-secondary)', border: '1px solid var(--da-border)' };
              return (
                <button
                  key={i}
                  onClick={() => setActiveFilter(f.filter)}
                  style={{ padding: '7px 14px', borderRadius: '9999px', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--da-font-family)', ...filterStyle }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.1fr 1.4fr .9fr 1.1fr .5fr', padding: '11px 20px', background: '#F1F8F3', fontSize: '10px', fontWeight: 800, color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)', letterSpacing: '.06em' }}>
          <span>REFERENCE ⇅</span><span>CUSTOMER ⇅</span><span>WORKSPACE</span><span>SCHEDULE ⇅</span><span>PAYMENT</span><span>STATUS</span><span style={{ textAlign: 'right' }}>ACTIONS</span>
        </div>

        {loading && reservations.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
            Loading reservations...
          </div>
        ) : error ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-danger)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
            {error}
          </div>
        ) : displayedReservations.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--da-text-secondary)', fontSize: '13px', fontFamily: 'var(--da-font-family)' }}>
            No reservations match your filters.
          </div>
        ) : (
          displayedReservations.map((r, i) => (
            <div
              key={r.id || i}
              onClick={() => router.push(`/manage/reservations/${r.referenceCode}`)}
              style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.1fr 1.4fr .9fr 1.1fr .5fr', padding: '13px 20px', borderTop: '1px solid var(--da-border-light)', fontSize: '12px', color: 'var(--da-text-primary)', fontFamily: 'var(--da-font-family)', cursor: 'pointer', alignItems: 'center' }}
            >
              <span style={{ fontWeight: 800, color: 'var(--da-brand-dark)' }}>{r.referenceCode}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--da-canvas)', color: 'var(--da-text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, flexShrink: 0 }}>{r.customerInitials}</div>
                <span style={{ fontWeight: 600 }}>{r.customerName}</span>
              </div>
              <span>{r.workspaceDisplayName}</span>
              <span style={{ color: 'var(--da-text-primary)' }}>{r.schedule}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: r.paymentColor }}>{r.paymentStatus}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 800, padding: '4px 9px', borderRadius: '9999px', whiteSpace: 'nowrap', width: 'fit-content', ...r.statusStyle }}>
                <span aria-hidden="true" style={{ fontSize: '10px', lineHeight: 1 }}>{r.mark}</span>{r.status}
              </span>
              <span style={{ textAlign: 'right', color: 'var(--da-text-secondary)', fontWeight: 800, letterSpacing: '1px' }}>⋯</span>
            </div>
          ))
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', borderTop: '1px solid var(--da-border-light)', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: 'var(--da-text-secondary)', fontFamily: 'var(--da-font-family)' }}>
            Showing {displayedReservations.length > 0 ? 1 : 0} to {displayedReservations.length} of {displayedReservations.length} entries
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {pages.map((pg, i) => (
              <button key={i} style={{ width: pg.label === 'Next' ? 'auto' : '36px', height: '36px', padding: pg.label === 'Next' ? '0 12px' : 0, borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--da-font-family)', ...pg.style }}>{pg.label}</button>
            ))}
          </div>
        </div>
      </div>

      <ReservationFilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        filters={advancedFilters}
        onApply={(newFilters) => setAdvancedFilters(newFilters)}
        onReset={() => setAdvancedFilters({})}
        availableTemplates={availableTemplates.length > 0 ? availableTemplates : undefined}
      />
    </main>
  );
}

