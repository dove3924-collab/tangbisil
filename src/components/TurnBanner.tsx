const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** 내 차례 알림 띠 (노랑, 5초 남으면 빨강) */
export default function TurnBanner({ title, sub, next, remaining, total, urgentAt = 5 }: {
  title: string; sub: string; next?: string; remaining: number | null; total: number; urgentAt?: number
}) {
  const urgent = remaining !== null && remaining <= urgentAt
  const pct = remaining !== null && total ? Math.min(100, (remaining / total) * 100) : 0
  return (
    <div className={'turnbar' + (urgent ? ' urgent' : '')} role="status">
      <span className="tb-bell" aria-hidden>🔔</span>
      <b>{title}</b>
      <span className="tb-sub">{sub}{next && <> · {next}</>}</span>
      {remaining !== null && (
        <span className="tb-time">{mmss(Math.ceil(remaining))}<span className="tb-bar"><i style={{ width: `${pct}%` }} /></span></span>
      )}
    </div>
  )
}
