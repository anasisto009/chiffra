type ProgressBarProps = {
  value: number;
  label: string;
};

export function ProgressBar({ value, label }: ProgressBarProps) {
  const bounded = Math.max(0, Math.min(100, value));

  return (
    <div className="progress" aria-label={label}>
      <div className="progress__meta">
        <span>{label}</span>
        <strong>{bounded.toFixed(0)}%</strong>
      </div>
      <div className="progress__track">
        <div className="progress__fill" style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}

