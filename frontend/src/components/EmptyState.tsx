import type { CSSProperties, ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
  style?: CSSProperties;
}

export default function EmptyState({
  icon,
  title,
  description,
  children,
  className = 'error-state',
  role = 'status',
  style,
}: EmptyStateProps) {
  return (
    <div className={className} style={style} role={role}>
      <div className="error-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
