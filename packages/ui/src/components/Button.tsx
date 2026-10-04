import React, { forwardRef } from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled,
      children,
      className = '',
      type = 'button',
      ...props
    },
    ref
  ) => {
    const variantClass =
      variant === 'primary'
        ? 'da-primary-button'
        : variant === 'secondary'
        ? 'da-secondary-button'
        : variant === 'danger'
        ? 'da-danger-button'
        : variant === 'accent'
        ? 'da-accent-button'
        : 'da-ghost-button';

    const sizeClass =
      size === 'sm'
        ? 'px-3 py-1.5 text-xs rounded-lg'
        : size === 'lg'
        ? 'px-6 py-3 text-base rounded-xl font-bold'
        : 'px-4 py-2 text-sm rounded-lg font-semibold';

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        aria-disabled={disabled || isLoading ? 'true' : undefined}
        className={`${variantClass} ${sizeClass} inline-flex items-center justify-center gap-2 ${className}`}
        {...props}
      >
        {isLoading ? (
          <span
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            data-testid="button-spinner"
          />
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
