import { flushOpenEditor } from '../../features/note-edit/editorFlush';
import { useState } from 'react';
import { NoteCard } from '../../features/note-edit/NoteCard';
import { OpenNote } from '../../features/note-edit/note-route';
import { call } from '../../entities/workspace/storage';
import { useRead } from '../../entities/workspace/useRead';

export function SourceConnections({ id, revision, changed, busy, run }) {
  const { value, error } = useRead('sourceDetails', id, revision);
  const { value: notes } = useRead('listNotes', '', revision);
  const [topic, setTopic] = useState('');
  const [claim, setClaim] = useState('');
  const [picked, setPicked] = useState('');
  const [editing, setEditing] = useState('');
  const update = (action, target, value, done) => run(async () => {
    await call('editSourceLinks', id, action, target, value);
    done?.();
  }, true);
  if (error) return <p role="alert">{error}</p>;
  if (!value) return null;
  return <div className="space-y-4 border-t border-base-300 p-3">
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Topics</h3>
      {value.topics.map((row) => <div key={row.id} className="flex items-center gap-2">
        <span className="flex-1">{row.name}</span>
        <input type="range" min="0" max="1" step="0.1" defaultValue={row.strength}
          key={row.strength} disabled={busy} aria-label={`Strength for ${row.name}`}
          onBlur={(event) => {
            if (event.target.valueAsNumber !== row.strength) void update('setStrength', row.id, event.target.valueAsNumber);
          }} onPointerUp={(event) => event.currentTarget.blur()} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
          onClick={() => update('detachTopic', row.id)}>Remove</button>
      </div>)}
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        void update('addTopic', topic.trim(), null, () => setTopic(''));
      }}>
        <input className="input input-sm" aria-label="Topic name" placeholder="Find or add a topic" value={topic}
          onChange={(event) => setTopic(event.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={busy || !topic.trim()}>Add topic</button>
      </form>
    </section>
    <section aria-label="Claims" className="space-y-2">
      <h3 className="text-sm font-semibold">Claims</h3>
      {value.claims.map((note) => <div key={note.id} className="space-y-2 border-b border-base-300 py-2">
        {editing === note.id ? <OpenNote id={note.id} notes={notes ?? []} changed={changed} returnTo={`/sources/${id}`} />
          : <NoteCard note={note} />}
        <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { if (await flushOpenEditor()) setEditing(editing === note.id ? '' : note.id); }}>
          {editing === note.id ? 'Close editor' : 'Edit claim'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
          onClick={async () => { if (await flushOpenEditor()) void update('detachClaim', note.id); }}>Detach claim</button>
      </div>)}
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault();
        void update('addClaim', crypto.randomUUID(), claim, () => setClaim(''));
      }}>
        <textarea className="textarea w-full" aria-label="New claim" placeholder="What does this source claim?" value={claim}
          onChange={(event) => setClaim(event.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !claim.trim()}>Add claim</button>
      </form>
      <div className="flex gap-2">
        <select className="select select-sm" aria-label="Note to attach as a claim" value={picked}
          onChange={(event) => setPicked(event.target.value)}>
          <option value="">Choose a note</option>
          {notes?.filter((note) => !value.claims.some((claim) => claim.id === note.id)).map((note) =>
            <option key={note.id} value={note.id}>{note.title || '(empty)'}</option>)}
        </select>
        <button type="button" className="btn btn-sm" disabled={busy || !picked}
          onClick={() => update('attachClaim', picked, null, () => setPicked(''))}>Attach note</button>
      </div>
    </section>
  </div>;
}
