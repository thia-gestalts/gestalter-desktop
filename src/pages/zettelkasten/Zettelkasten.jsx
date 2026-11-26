import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { NoteCard } from '../../features/note-edit/NoteCard';
import { InlineMarkdown } from '../../dumb/InlineMarkdown';
import { edit } from '../../entities/workspace/storage';
import { useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useRead } from '../../entities/workspace/useRead';

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

function NoteRows({ rows, selected }) {
  return (
    <ul className="space-y-1">
      {rows.map((note) => (
        <li key={note.id}>
          <Link to={`${route}/${note.id}`} aria-current={note.id === selected ? 'page' : undefined}
            className={`block rounded-md px-3 py-2 text-sm hover:bg-base-200 ${note.id === selected ? 'bg-base-300 font-medium' : ''}`}>
            <InlineMarkdown>{note.title || '(empty)'}</InlineMarkdown>
          </Link>
          {note.marks.length > 0 && (
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
  const [confirmUnplace, setConfirmUnplace] = useState(false);
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
        {current && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => {
          if ([...entries.values()].some((entry) => entry.place?.id === note.id)) setConfirmUnplace(true);
          else void place('unplace');
        }}>Unplace</button>}
        {status === 'unplaced' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => place('exclude')}>Exclude</button>}
        {excluded && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => place('include')}>Include again</button>}
      </div>
      {confirmUnplace && <div role="alertdialog" aria-label="Unplace note" className="alert">
        <p>Notes placed below this one will need attention.</p>
        <button type="button" className="btn btn-sm" onClick={() => setConfirmUnplace(false)}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => {
          setConfirmUnplace(false);
          void place('unplace');
        }}>Unplace note</button>
      </div>}
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
  const { revision, changed } = useOutletContext();
  const { value, error } = useRead('zettelkasten', undefined, revision);
  const [selected, setSelected] = useState();
  const [expanded, setExpanded] = useState(() => new Set());
  const [skipped, setSkipped] = useState();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const entries = new Map(value?.entries.map((entry) => [entry.id, entry]));
  const tree = value?.rows.map((key) => entries.get(key)) ?? [];
  const choices = value?.entries ?? [];
  const unplaced = choices.filter((note) => note.status === 'unplaced');
  const subjectId = id ?? (unplaced.find((note) => note.id !== skipped) ?? unplaced[0])?.id;
  const { value: note, error: noteError } = useRead('getNote', subjectId, revision);
  const needsAttention = choices.filter((entry) => entry.status === 'floating' || entry.marks.length);
  const chain = (entry) => {
    const path = [];
    const visited = new Set();
    while (entry && !visited.has(entry.id)) {
      visited.add(entry.id);
      path.unshift(entry);
      entry = entry.status === 'root' ? undefined : entries.get(entry.place?.id);
    }
    return path;
  };
  const trail = chain(entries.get(subjectId));
  const trailKey = JSON.stringify(trail.map((entry) => entry.id));
  useEffect(() => {
    if (!id) return;
    setExpanded((current) => new Set([...current, ...JSON.parse(trailKey)]));
    const frame = requestAnimationFrame(() => document.getElementById(`outline-${id}`)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [id, trailKey]);

  const place = async (action, target) => {
    if (!note || busy) return;
    setBusy(true);
    setFailure('');
    try {
      await edit(note.olympHeads, 'placeNote', note.id, action, target);
      if (action === branches) setExpanded((current) => new Set([...current, target]));
      setSelected(undefined);
      changed();
    } catch (error) {
      setFailure(error.message);
    } finally {
      setBusy(false);
      setDragging(false);
    }
  };

  // Followers share their predecessor's level. Only branch edges require an expanded ancestor.
  const visible = tree.filter((entry) => chain(entry).every((node) =>
    node.place?.relation !== branches || node.status === 'root' || expanded.has(node.place.id)));
  const branchParents = new Set(tree.filter((entry) => entry.place?.relation === branches)
    .map((entry) => entry.place.id));
  const canTarget = (entry) => note && !['root', 'excluded'].includes(entries.get(note.id)?.status)
    && !chain(entry).some((node) => node.id === note.id);
  return <main className="min-h-0 flex-1 bg-base-100 md:flex" aria-label="Zettelkasten">
    <aside className="space-y-4 border-base-300 p-3 md:w-[26rem] md:shrink-0 md:overflow-y-auto md:border-e">
      {(failure || error || noteError) && <p role="alert" className="alert alert-error">{failure || error || noteError}</p>}
      {note && note.id === subjectId && <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{statuses[entries.get(note.id)?.status]}</span>
          <Link to={`/notes/${note.id}`} className="btn btn-ghost btn-sm"><Pencil size={16} /> Edit</Link>
        </div>
        {trail.length > 1 && <nav className="flex flex-wrap gap-2 text-sm" aria-label="Placement path">
          {trail.map((entry) => <Link key={entry.id} className="link" to={`${route}/${entry.id}`}>{entry.title || '(empty)'}</Link>)}
        </nav>}
        <article draggable={entries.get(note.id)?.status !== 'root'} className="space-y-2"
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', note.id);
            setDragging(true);
          }} onDragEnd={() => setDragging(false)}>
          <NoteCard note={note} />
        </article>
        {id ? <Link to={route} className="btn btn-sm">Next unplaced note</Link>
          : <button type="button" className="btn btn-sm" onClick={() => setSkipped(note.id)}>Skip</button>}
        <Placement key={note.id} note={note} entries={entries} busy={busy} place={place} />
      </section>}
      {value && !subjectId && <p className="p-4 text-center text-base-content/60">All notes are placed.</p>}
      {!!needsAttention.length && <section>
        <h2 className="text-sm font-semibold uppercase text-base-content/60">Attention</h2>
        <NoteRows rows={needsAttention} selected={id} />
      </section>}
    </aside>
    <section className="min-w-0 flex-1 p-3 md:overflow-y-auto" aria-label="Outline">
      <h2 className="mb-2 text-sm font-semibold uppercase text-base-content/60">Zettelkasten</h2>
      {value && !tree.length && <p className="text-base-content/60">No root note yet.</p>}
      <ul>{visible.map((entry) => {
        const open = expanded.has(entry.id);
        const eligible = canTarget(entry);
        return <li key={entry.id} id={`outline-${entry.id}`} className={`ms-[calc(var(--depth)*1.25rem)] ${entry.id === subjectId ? 'outline outline-primary' : ''}`}
          style={{ '--depth': entry.depth }}
          onDragEnter={() => { if (dragging && eligible) setSelected(entry.id); }}>
          <div className="flex items-center gap-1">
            {branchParents.has(entry.id) ? <button type="button" className="btn btn-ghost btn-sm btn-square"
              aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => setExpanded((current) => {
                const next = new Set(current);
                if (next.has(entry.id)) next.delete(entry.id);
                else next.add(entry.id);
                return next;
              })}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : <span className="w-7" />}
            <button type="button" className="min-w-0 flex-1 py-1 text-start" aria-expanded={selected === entry.id}
              onClick={() => setSelected(selected === entry.id ? undefined : entry.id)}><InlineMarkdown>{entry.title || '(empty)'}</InlineMarkdown></button>
          </div>
          {selected === entry.id && <div className="flex flex-wrap gap-2 py-1 ps-8">
            {eligible && [[follows, 'Place after'], [branches, 'Branch from']].map(([action, label]) => {
              const here = entries.get(subjectId)?.place;
              const disabled = busy || (action === follows && entry.hasFollower)
                || (here?.id === entry.id && here.relation === action);
              return <button key={action} type="button" className={`btn btn-sm ${dragging ? 'border-dashed border-primary' : ''}`}
                disabled={disabled} onClick={() => place(action, entry.id)}
                onDragOver={(event) => {
                  if (!dragging || disabled) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }} onDrop={(event) => {
                  event.preventDefault();
                  if (dragging && !disabled && event.dataTransfer.getData('text/plain') === subjectId) {
                    void place(action, entry.id);
                  }
                }}>{label}</button>;
            })}
            <Link className="btn btn-sm" to={`${route}/${entry.id}`}>Focus</Link>
            <Link className="btn btn-ghost btn-sm" to={`/notes/${entry.id}`}>Edit</Link>
          </div>}
        </li>;
      })}</ul>
    </section>
  </main>;
}
