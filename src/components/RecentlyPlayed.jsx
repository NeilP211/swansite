import Thumb from './Thumb'
import Empty from './Empty'

export default function RecentlyPlayed({ recent }) {
  const plays = [...(recent?.plays || [])].sort(
    (a, b) => new Date(b.played_at) - new Date(a.played_at)
  )
  return (
    <div className="card col-4">
      <h2>Recently Played</h2>
      <div className="ticker">
        {plays.slice(0, 40).map((p, i) => (
          <div className="tick" key={`${p.played_at}-${i}`}>
            <Thumb name={p.album || p.name} image={p.image} />
            <div className="meta">
              <div className="name">{p.name}</div>
              <div className="sub">{(p.artists || []).join(', ')}</div>
            </div>
          </div>
        ))}
        {!plays.length && <Empty text="Plays will appear here as the fetch job runs." />}
      </div>
    </div>
  )
}
