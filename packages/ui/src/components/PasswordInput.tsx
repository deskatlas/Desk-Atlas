"use client";

import React, { useState, useRef, useImperativeHandle } from 'react';

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  containerStyle?: React.CSSProperties;
  containerClassName?: string;
  buttonAriaLabelShow?: string;
  buttonAriaLabelHide?: string;
  onToggleVisibility?: (visible: boolean) => void;
  defaultVisible?: boolean;
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      style,
      containerStyle,
      containerClassName,
      buttonAriaLabelShow = 'Show password',
      buttonAriaLabelHide = 'Hide password',
      onToggleVisibility,
      defaultVisible = false,
      disabled = false,
      ...rest
    },
    ref
  ) => {
    const [isVisible, setIsVisible] = useState(defaultVisible);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (disabled) return;

      const input = inputRef.current;
      const start = input?.selectionStart;
      const end = input?.selectionEnd;
      const nextVisible = !isVisible;

      setIsVisible(nextVisible);
      if (onToggleVisibility) {
        onToggleVisibility(nextVisible);
      }

      if (input && typeof start === 'number' && typeof end === 'number') {
        requestAnimationFrame(() => {
          try {
            input.focus();
            input.setSelectionRange(start, end);
          } catch {
            // Ignored if element is not in DOM or not focusable
          }
        });
      }
    };

    // Extract outer margin styles so the relative container wraps the input bounds cleanly
    const {
      margin,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      width = '100%',
      flex,
      display,
      ...inputSpecificStyles
    } = style || {};

    return (
      <div
        className={containerClassName}
        data-testid="password-input-container"
        style={{
          position: 'relative',
          display: display || 'flex',
          alignItems: 'center',
          width,
          margin,
          marginTop,
          marginBottom,
          marginLeft,
          marginRight,
          flex,
          boxSizing: 'border-box',
          ...containerStyle,
        }}
      >
        <input
          ref={inputRef}
          type={isVisible ? 'text' : 'password'}
          disabled={disabled}
          data-testid="password-input"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            paddingRight: '38px',
            margin: 0,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            ...inputSpecificStyles,
          }}
          {...rest}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={isVisible ? buttonAriaLabelHide : buttonAriaLabelShow}
          title={isVisible ? buttonAriaLabelHide : buttonAriaLabelShow}
          onClick={handleToggle}
          data-testid="password-toggle-btn"
          style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            padding: '4px',
            margin: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 0.65,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--da-text-secondary, #6B7280)',
            lineHeight: 1,
            borderRadius: '4px',
            transition: 'opacity 0.15s ease, color 0.15s ease',
            zIndex: 2,
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              (e.currentTarget as HTMLElement).style.opacity = '1';
              (e.currentTarget as HTMLElement).style.color = 'var(--da-text-primary, #111827)';
            }
          }}
          onMouseLeave={(e) => {
            if (!disabled) {
              (e.currentTarget as HTMLElement).style.opacity = '0.65';
              (e.currentTarget as HTMLElement).style.color = 'var(--da-text-secondary, #6B7280)';
            }
          }}
        >
          {isVisible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';
