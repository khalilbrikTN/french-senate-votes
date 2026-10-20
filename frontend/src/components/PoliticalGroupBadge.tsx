interface PoliticalGroupBadgeProps {
  label: string;
  color: string;
  className: string;
  backgroundColor: string;
  borderColor: string;
  dotSize: number;
}

export default function PoliticalGroupBadge({
  label,
  color,
  className,
  backgroundColor,
  borderColor,
  dotSize,
}: PoliticalGroupBadgeProps) {
  return (
    <div className={className} style={{ background: backgroundColor, color, border: `1px solid ${borderColor}` }}>
      <span
        aria-hidden="true"
        style={{ display: 'inline-block', width: dotSize, height: dotSize, borderRadius: '50%', background: color }}
      />
      {label}
    </div>
  );
}
