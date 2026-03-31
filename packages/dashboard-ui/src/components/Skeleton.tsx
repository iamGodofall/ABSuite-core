import React from 'react';
import { cn } from '../utils';

const Skeleton = {
  line: ({ className }: { className?: string }) => (
    <div
      className={cn(
        'h-4 bg-bg-tertiary rounded animate-pulse',
        className
      )}
    />
  ),
  card: ({ className }: { className?: string }) => (
    <div
      className={cn(
        'bg-bg-secondary border border-border rounded-lg p-6 animate-pulse',
        className
      )}
    >
      <div className="h-6 bg-bg-tertiary rounded w-3/4 mb-4" />
      <div className="space-y-2">
        <Skeleton.line className="w-1/2 h-3" />
        <Skeleton.line className="w-1/3 h-3" />
      </div>
    </div>
  ),
};

export { Skeleton };
