import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from './utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  fullWidth = false,
  disabled,
  ...props
}) => {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        fullWidth && 'w-full',
        {
          // Sizes
          'h-9 px-4 py-2 text-sm': size === 'sm',
          'h-10 px-4 py-2 text-sm': size === 'md',
          'h-12 px-6 py-3 text-base': size === 'lg',
          // Variants (using CSS vars)
          'bg-accent-primary text-bg-primary hover:bg-green-500 focus-visible:ring-accent-primary': variant === 'primary',
          'bg-bg-tertiary text-text-primary border border-border hover:bg-border focus-visible:ring-accent-secondary': variant === 'secondary',
          'bg-transparent text-text-secondary border border-border hover:text-text-primary hover:border-text-secondary focus-visible:ring-accent-secondary': variant === 'tertiary',
          'bg-accent-danger text-bg-primary hover:bg-red-600 focus-visible:ring-accent-danger': variant === 'danger',
        },
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin -ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : Icon ? (
        <Icon className="h-4 w-4 mr-2" />
      ) : null}
      {children}
    </button>
  );
};

export { Button };
