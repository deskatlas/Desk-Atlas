'use client';

import React from 'react';
import {
  formatRemainingDuration,
  type FormattedRemainingDuration,
  type CountdownUrgency,
} from '../hooks/useLiveCountdownClock';

export interface WorkspaceCountdownBadgeProps {
  bookingEndAt?: string | Date | null;
  remainingInfo?: FormattedRemainingDuration;
  nowMs?: number;
  compact?: boolean;
  showIcon?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function WorkspaceCountdownBadge({
  bookingEndAt,
  remainingInfo,
  nowMs,
  compact = false,
  showIcon = true,
  className,
  style,
}: WorkspaceCountdownBadgeProps) {
  const info = remainingInfo ?? formatRemainingDuration(bookingEndAt, nowMs);

  if (!bookingEndAt && !remainingInfo) {
    return null;
  }

  const getUrgencyStyles = (urgency: CountdownUrgency): React.CSSProperties => {
    switch (urgency) {
      case 'urgent':
        return {
          background: '#DC2626',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.5)',
          boxShadow: '0 1px 3px rgba(220, 38, 38, 0.4)',
        };
      case 'warning':
        return {
          background: '#D97706',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 1px 3px rgba(217, 119, 6, 0.3)',
        };
      case 'expired':
        return {
          background: 'rgba(100, 116, 139, 0.85)',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        };
      case 'normal':
      default:
        return {
          background: 'rgba(0, 0, 0, 0.32)',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.18)',
        };
    }
  };

  const urgencyStyle = getUrgencyStyles(info.urgency);

  return (
    <span
      data-testid="workspace-countdown-badge"
      data-urgency={info.urgency}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        fontSize: '10px',
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.02em',
        borderRadius: '4px',
        padding: compact ? '1px 3px' : '2px 5px',
        lineHeight: 1.1,
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        pointerEvents: 'none',
        ...urgencyStyle,
        ...style,
      }}
    >
      {showIcon && (
        <span style={{ fontSize: '9px', lineHeight: 1 }}>⏳</span>
      )}
      <span>{info.isExpired ? 'Overdue' : info.formatted}</span>
    </span>
  );
}
