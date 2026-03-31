import React from 'react';
import { cn } from '../utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

const Card: React.FC<CardProps> = ({
  children,
  header,
  footer,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'glass-card border-glass-border bg-bg-secondary/80 backdrop-blur-md shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 overflow-hidden rounded-2xl',
        className
      )}
      {...props}
    >
      {header && (
        <div className="border-b border-border p-6">
          {header}
        </div>
      )}
      <div className="p-6">
        {children}
      </div>
      {footer && (
        <div className="border-t border-border p-6 bg-bg-tertiary/50">
          {footer}
        </div>
      )}
    </div>
  );
};

export { Card };
