import { useOutletContext } from 'react-router-dom';
import { useRead } from '../../entities/workspace/useRead';

function OccurrenceTime({ milliseconds }) {
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? <span>{milliseconds} ms UTC</span>
    : <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>;
}

function Occurrences({ events }) {
  return <ul className="divide-y divide-base-300">
    {events.map((event) => {
      return <li key={event.id} className="py-2 text-sm">
        <OccurrenceTime milliseconds={event.occurredAtMs} />
        {event.origin && <span> · {event.origin.app} / {event.origin.activity}</span>}
        {event.score != null && <span> · Score {event.score}</span>}
        <p>{event.targets.map((target) => target.label).join(' · ')}</p>
      </li>;
    })}
  </ul>;
}

export function Practice() {
  const { revision } = useOutletContext();
  const { value: rows, error } = useRead('recentPractice', undefined, revision);
  const { value: events, error: historyError } = useRead('learningHistory', undefined, revision);
  return <main className="mx-auto max-w-4xl space-y-5 p-5">
    <h1 className="text-xl font-semibold">Recent practice</h1>
    {(error || historyError) && <p role="alert">{error || historyError}</p>}
    {rows?.length === 0 && <p>No practice recorded yet.</p>}
    {!!rows?.length && <ul className="divide-y divide-base-300">
      {rows.map((row) => <li key={JSON.stringify([row.kind, row.id])} className="flex items-center justify-between gap-2 py-2">
        <div><span className="text-xs capitalize text-base-content/65">{row.kind}</span><p>{row.label}</p></div>
        <span className="text-sm text-base-content/65"><OccurrenceTime milliseconds={row.occurredAtMs} /></span>
      </li>)}
    </ul>}
    {events?.some((event) => event.type === 'attempt') && <details>
      <summary className="cursor-pointer font-medium">Practice history</summary>
      <Occurrences events={events.filter((event) => event.type === 'attempt')} />
    </details>}
    {events?.some((event) => event.type === 'engagement') && <details>
      <summary className="cursor-pointer font-medium">Engagements</summary>
      <Occurrences events={events.filter((event) => event.type === 'engagement')} />
    </details>}
  </main>;
}
