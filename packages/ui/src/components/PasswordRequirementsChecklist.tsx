import React from 'react';
import { validatePassword } from '@deskatlas/domain';

export interface PasswordRequirementsChecklistProps {
  password?: string;
  showWhenEmpty?: boolean;
}

export function PasswordRequirementsChecklist({
  password = '',
  showWhenEmpty = false,
}: PasswordRequirementsChecklistProps) {
  if (!showWhenEmpty && !password) {
    return null;
  }

  const result = validatePassword(password);

  return (
    <div
      data-testid="password-requirements-checklist"
      style={{
        marginTop: '6px',
        marginBottom: '4px',
        padding: '8px 12px',
        background: result.isValid ? '#F0FDF4' : '#F9FAFB',
        border: result.isValid ? '1px solid #BBF7D0' : '1px solid #E5E7EB',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '11px',
        color: 'var(--da-text-secondary, #4B5563)',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: '11px',
          color: result.isValid ? '#15803D' : '#374151',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2px',
        }}
      >
        <span>Password Requirements:</span>
        {result.isValid && (
          <span style={{ color: '#16A34A', fontWeight: 800 }}>All criteria met</span>
        )}
      </div>

      {result.rules.map((rule) => (
        <div
          key={rule.id}
          data-rule-id={rule.id}
          data-rule-passed={rule.passed}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: rule.passed ? '#15803D' : '#6B7280',
            fontWeight: rule.passed ? 600 : 400,
            transition: 'color 0.15s ease',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              background: rule.passed ? '#DCFCE7' : '#E5E7EB',
              color: rule.passed ? '#16A34A' : '#9CA3AF',
              fontSize: '10px',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {rule.passed ? '✓' : '•'}
          </span>
          <span>{rule.label}</span>
        </div>
      ))}
    </div>
  );
}
