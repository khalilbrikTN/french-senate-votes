import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: ReactNode;
  count: ReactNode;
}

export default function SectionHeader({ title, count }: SectionHeaderProps) {
  return (
    <div className="section-header" aria-live="polite">
      <h2 className="section-title">{title}</h2>
      <div className="results-count">{count}</div>
    </div>
  );
}
