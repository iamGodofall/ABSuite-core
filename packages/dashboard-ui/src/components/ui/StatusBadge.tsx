import React from 'react';
import { cn } from '../../utils';

interface StatusBadgeProps {
  status: 'up' | 'down' | 'unknown' | 'warning';
  className?: string;
  children?: React.ReactNode;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className,
  children,
}) => {
  const statusConfig = {
    up: 'bg-accent-primary/20 text-accent-primary border-accent-primary/30',
    down: 'bg-accent-danger/20 text-accent-danger border-accent-danger/30',
    unknown: 'bg-accent-warning/20 text-accent-warning border-accent-warning/30',
    warning: 'bg-[#fbbf24]/20 text-[#fbbf24] border-[#fbbf24]/30',
  };

  return (
    <span
      className={cn(
        'inline-flex px-3 py-1 rounded-full text-xs font-medium border',
        statusConfig[status],
        className
      )}
    >
      {children || status.toUpperCase()}
    </span>
  );
};

export { StatusBadge };
