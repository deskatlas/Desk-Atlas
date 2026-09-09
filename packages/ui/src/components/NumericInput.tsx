import React from 'react';

export interface NumericInputKeyOptions {
  allowDecimal?: boolean;
  allowNegative?: boolean;
}

/**
 * KeyDown handler to block non-numeric keys while allowing:
 * - digits 0-9
 * - navigation & cursor control (Arrow keys, Home, End)
 * - editing keys (Backspace, Delete)
 * - tab and enter
 * - standard copy/cut/paste/select-all shortcuts (Ctrl/Cmd + A, C, V, X, Z)
 */
export function handleNumericKeyDown(
  e: React.KeyboardEvent<HTMLInputElement>,
  options: NumericInputKeyOptions = {}
): void {
  const { allowDecimal = false, allowNegative = false } = options;

  // Allow modifier keys (Ctrl, Cmd, Alt) for shortcuts like Ctrl+A, Ctrl+C, Ctrl+V, etc.
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  }

  // Always allowed control keys
  const allowedControlKeys = [
    'Backspace',
    'Delete',
    'Tab',
    'Enter',
    'Escape',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
  ];

  if (allowedControlKeys.includes(e.key)) {
    return;
  }

  // Disallow scientific notation ('e', 'E') explicitly
  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    return;
  }

  // Allow decimal point if configured and not already present
  if (e.key === '.') {
    if (!allowDecimal || (e.currentTarget.value && e.currentTarget.value.includes('.'))) {
      e.preventDefault();
    }
    return;
  }

  // Allow minus sign if configured and at the beginning
  if (e.key === '-') {
    if (!allowNegative || e.currentTarget.selectionStart !== 0 || e.currentTarget.value.includes('-')) {
      e.preventDefault();
    }
    return;
  }

  // Block any other key that is not a digit 0-9
  if (!/^[0-9]$/.test(e.key)) {
    e.preventDefault();
  }
}

/**
 * Safely parse a numeric string, returning empty string if raw input is blank,
 * or the numeric value if valid.
 */
export function parseNumericInput(rawValue: string, fallback?: number): number | '' {
  const trimmed = rawValue.trim();
  if (trimmed === '') {
    return fallback !== undefined ? fallback : '';
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return fallback !== undefined ? fallback : '';
  }
  return parsed;
}

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: number | string | null | undefined;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>, numericValue: number | '') => void;
  onValueChange?: (value: number | '') => void;
  allowDecimal?: boolean;
  allowNegative?: boolean;
  fallbackOnBlur?: number;
}

export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  (
    {
      value,
      onChange,
      onValueChange,
      onKeyDown,
      onBlur,
      allowDecimal = false,
      allowNegative = false,
      fallbackOnBlur,
      type = 'number',
      ...rest
    },
    ref
  ) => {
    const displayValue = value === null || value === undefined ? '' : String(value);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const parsed = parseNumericInput(raw);
      if (onChange) {
        onChange(e, parsed);
      }
      if (onValueChange) {
        onValueChange(parsed);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      handleNumericKeyDown(e, { allowDecimal, allowNegative });
      if (onKeyDown) {
        onKeyDown(e);
      }
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      if (fallbackOnBlur !== undefined && e.target.value.trim() === '') {
        if (onValueChange) {
          onValueChange(fallbackOnBlur);
        }
      }
      if (onBlur) {
        onBlur(e);
      }
    };

    return (
      <input
        ref={ref}
        type={type}
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        {...rest}
      />
    );
  }
);

NumericInput.displayName = 'NumericInput';
