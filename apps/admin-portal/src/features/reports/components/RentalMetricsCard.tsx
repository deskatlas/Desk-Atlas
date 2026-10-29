"use client";

import React from 'react';
import type { RentalAnalyticsSnapshot } from '@deskatlas/domain';

export interface RentalMetricsCardProps {
  analytics?: RentalAnalyticsSnapshot | null;
  loading?: boolean;
}

export function RentalMetricsCard({ analytics, loading }: RentalMetricsCardProps) {
  const totalRevenue = analytics?.totalRentalRevenue ?? 0;
  const activeCount = analytics?.activeRentalsCount ?? 0;
  const returnedCount = analytics?.returnedRentalsCount ?? 0;
  const overdueCount = analytics?.overdueRentalsCount ?? 0;

  const formattedRevenue = `PHP ${totalRevenue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const cards = [
    {
      label: 'Rental & Service Revenue',
      value: formattedRevenue,
      subtext: `${analytics?.totalRentalsCount ?? 0} total transactions`,
      highlight: false,
    },
    {
      label: 'Active Rentals',
      value: activeCount.toString(),
      subtext: 'Equipment currently in use',
      highlight: false,
      hasPulse: true,
    },
    {
      label: 'Completed Rentals',
      value: returnedCount.toString(),
      subtext: 'Returned in good order',
      highlight: false,
    },
    {
      label: 'Overdue Rentals',
      value: overdueCount.toString(),
      subtext: overdueCount > 0 ? 'Requires operational follow-up' : 'All equipment on schedule',
      highlight: overdueCount > 0,
    },
  ];

  return (
    <div
      data-testid="rental-metrics-container"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '14px',
        marginBottom: '24px',
      }}
    >
      {cards.map((card, i) => (
        <div
          key={i}
          style={{
            background: card.highlight ? '#fff1f2' : '#fff',
            border: `1px solid ${card.highlight ? '#fecdd3' : 'var(--da-border, #e2e8f0)'}`,
            borderRadius: '14px',
            padding: '20px',
            boxShadow: 'var(--da-shadow-sm, 0 1px 2px 0 rgba(0, 0, 0, 0.05))',
            opacity: loading ? 0.7 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              color: card.highlight ? '#9f1239' : 'var(--da-text-secondary, #64748b)',
              fontFamily: 'var(--da-font-family, inherit)',
              marginBottom: '8px',
              fontWeight: 600,
            }}
          >
            {card.label}
          </div>
          <div
            style={{
              fontSize: '26px',
              fontWeight: 800,
              color: card.highlight ? '#be123c' : 'var(--da-brand-dark, #0f172a)',
              marginBottom: '8px',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {card.hasPulse && (
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.25)',
                }}
              />
            )}
            {card.value}
          </div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: card.highlight ? '#9f1239' : 'var(--da-text-secondary, #64748b)',
              fontFamily: 'var(--da-font-family, inherit)',
            }}
          >
            {card.subtext}
          </div>
        </div>
      ))}
    </div>
  );
}

