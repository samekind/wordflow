type Props = { value: number; onChange: (value: number) => void; label: string; disabled?: boolean }

export const validDailyCount = (value: number) => Number.isInteger(value) && value >= 5 && value <= 100

export default function DailyWordCount({ value, onChange, label, disabled }: Props) {
  return <div className="daily-count">
    <label className="setting-row"><span>{label}</span><span className="daily-count-input">
      <input aria-label={label} type="number" min={5} max={100} step={1} value={value || ''} disabled={disabled}
        onChange={event => onChange(event.target.valueAsNumber || 0)} /><span>词 / 天</span>
    </span></label>
    <input aria-label={`${label}滑块`} type="range" min={5} max={100} step={1} value={Math.max(5, Math.min(100, value))} disabled={disabled}
      onChange={event => onChange(Number(event.target.value))} />
    <div className="daily-count-range"><span>5 词</span><span>100 词</span></div>
    {!validDailyCount(value) && <p className="error-banner" role="alert">请输入 5 至 100 的整数</p>}
  </div>
}
