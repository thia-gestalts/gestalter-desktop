import { useState } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { OpenNote, useRead } from './note-route';

const route = '/zettelkasten';
const follows = 'follows';
const branches = 'branches from';
const statuses = {
  root: 'Root', attached: 'Placed', floating: 'Floating', unplaced: 'Unplaced', excluded: 'Excluded',
};
const problems = {
  extraRoot: 'Another note is the active root.',
  rootPlaced: 'The root also has a placement.',
  placedTwice: 'This note has multiple placements. The first one is shown.',
  excludedPlaced: 'This note is excluded and has a placement.',
  fork: 'More than one note follows this target.',
  cycle: 'This placement is part of a cycle.',
  parentMissing: 'The placement target is missing.',
  parentUnplaced: 'The placement target is unplaced.',
  parentExcluded: 'The placement target is excluded.',
};

function NoteRows({ rows, selected, showDepth = false }) {
  return (
    <ul className="space-y-1">
      {rows.map((note) => (
        <li key={note.id} style={showDepth ? { marginInlineStart: `${Math.min(note.depth, 8)}rem` } : undefined}>
          <Link to={`${route}/${note.id}`} aria-current={note.id === selected ? 'page' : undefined}
            className={`block rounded-md px-3 py-2 text-sm hover:bg-base-200 ${note.id === selected ? 'bg-base-300 font-medium' : ''}`}>
            {showDepth && note.place?.relation === branches && note.status === 'attached' && <span aria-label="Branch">↳ </span>}
            {note.title}
            {showDepth && note.status === 'root' && <span className="ml-2 text-xs text-base-content/65">Root</span>}
          </Link>
          {note.marks.length > 0 && !showDepth && (
            <ul className="px-3 pb-2 text-xs text-base-content/75">
              {note.marks.map(({ kind }) => <li key={kind}>{problems[kind]}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Placement({ note, entries, busy, place }) {
  const [target, setTarget] = useState('');
  const subject = entries.get(note.id);
  if (!subject) return null;
  const { status, place: current, marks } = subject;
  const root = [...entries.values()].find((entry) => entry.status === 'root');
  const parent = entries.get(current?.id);
  const canPlace = root && status !== 'root' && status !== 'excluded';
  const unavailable = new Set([note.id]);
  if (canPlace) {
    // Rows are parent-first. A placed target below this note would make a cycle.
    for (const entry of entries.values()) {
      if (entry.status !== 'root' && unavailable.has(entry.place?.id)) unavailable.add(entry.id);
    }
  }
  const targets = canPlace ? [...entries.values()].filter((entry) =>
    (entry.status === 'root' || entry.status === 'attached') && !unavailable.has(entry.id)) : [];
  const selected = targets.find((entry) => entry.id === target);
  const followTaken = selected?.hasFollower && [...entries.values()].some((entry) =>
    entry.id !== note.id && entry.status !== 'root' && entry.place?.id === selected.id && entry.place.relation === follows);
  const excluded = note.tags?.includes('no-zettelkasten');
  const taggedRoot = note.tags?.includes('zettelkasten-root');
  return (
    <section className="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4" aria-label="Zettelkasten placement">
      <div className="flex flex-wrap items-center gap-x-3 text-sm">
        <h2 className="font-semibold">Placement</h2>
        <p>{statuses[status]}{current && status !== 'root' && (
          <> · {current.relation} {parent ? <Link className="link" to={`${route}/${parent.id}`}>{parent.title}</Link> : current.id}</>
        )}</p>
      </div>
      {marks.length > 0 && <ul className="text-sm">{marks.map(({ kind }) => <li key={kind}>{problems[kind]}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        {!root && status === 'unplaced' &&
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => place('root')}>Make root</button>}
        {taggedRoot && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => place('clearRoot')}>Clear root tag</button>}
        {current && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => place('unplace')}>Unplace</button>}
        {status === 'unplaced' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => place('exclude')}>Exclude</button>}
        {excluded && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => place('include')}>Include again</button>}
      </div>
      {targets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select className="select select-sm max-w-full" aria-label="Placement target" value={selected?.id ?? ''}
            onChange={(event) => setTarget(event.target.value)}>
            <option value="">Choose a placed note</option>
            {targets.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
          <button type="button" className="btn btn-sm" disabled={!selected || busy || followTaken}
            onClick={() => place(follows, target)}>Place after</button>
          <button type="button" className="btn btn-sm" disabled={!selected || busy}
            onClick={() => place(branches, target)}>Branch from</button>
          {followTaken && <p className="basis-full text-xs text-base-content/65">A note already follows this target.</p>}
        </div>
      )}
    </section>
  );
}

export function Zettelkasten() {
  const { id } = useParams();
  const { state } = useLocation();
  const { revision, changed } = useOutletContext();
  const { value, error } = useRead('zettelkasten', undefined, revision);
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const indexed = new Map(value?.entries.map((entry) => [entry.id, entry]));
  const tree = value?.rows.map((key) => indexed.get(key)) ?? [];
  const entries = new Map([...tree.map((entry) => [entry.id, entry]), ...indexed]);
  const choices = value?.entries ?? [];
  const needsAttention = choices.filter((note) => note.status === 'floating' || note.marks.length);
  return (
    <main className="grid min-h-[calc(100vh-3.5rem)] md:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="space-y-5 border-base-300 bg-base-100 px-4 py-5 md:border-r">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Zettelkasten</h1>
          <Link to={`${route}/${newId}`} state={{ draft: true }} className="btn btn-primary btn-sm"
            onClick={() => setNewId(crypto.randomUUID())}>New note</Link>
        </div>
        {error && <p role="alert" className="alert alert-error">{error}</p>}
        {value && <section aria-label="Outline">
          {tree.length ? <NoteRows rows={tree} selected={id} showDepth />
            : <p className="text-sm text-base-content/65">Choose an unplaced note to make the root.</p>}
        </section>}
        <section>
          <h2 className="font-semibold">Unplaced</h2>
          {value && !choices.some((note) => note.status === 'unplaced') && <p className="text-sm text-base-content/65">No unplaced notes.</p>}
          <NoteRows rows={choices.filter((note) => note.status === 'unplaced')} selected={id} />
        </section>
        {needsAttention.length > 0 && <section>
          <h2 className="font-semibold">Placement problems</h2>
          <NoteRows rows={needsAttention} selected={id} />
        </section>}
        {choices.some((note) => note.status === 'excluded') && <section>
          <h2 className="font-semibold">Excluded</h2>
          <NoteRows rows={choices.filter((note) => note.status === 'excluded')} selected={id} />
        </section>}
      </aside>
      {id ? <OpenNote key={id} id={id} draft={Boolean(state?.draft)} notes={choices} changed={changed} returnTo={route}
        renderActions={({ note, busy, place }) => note && <Placement note={note} entries={entries} busy={busy} place={place} />} />
        : <p className="p-8 text-base-content/65">Select a note to edit it or change its placement.</p>}
    </main>
  );
}
