import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { OpenNote } from '../../features/note-edit/note-route';
import { call } from '../../entities/workspace/storage';
import { useRead } from '../../entities/workspace/useRead';

export function WorkLinks({ artifactId, path, revision, changed, busy, run }) {
  const { noteId } = useParams();
  const { state } = useLocation();
  const { value, error } = useRead('sourceLinks', artifactId, revision);
  const { value: notes } = useRead('listNotes', '', revision);
  const [selectedNote, setSelectedNote] = useState('');
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [text, setText] = useState('');
  const [locator, setLocator] = useState('');
  const choices = notes?.filter(note => !value?.notes.some(row => row.id === note.id)) ?? [];
  if (error) return <p role="alert">{error}</p>;
  if (!value) return <p>Loading artifact…</p>;
  if (!value.artifact) return <p>This artifact is unavailable.</p>;
  return (
    <section aria-label="Notes and annotations" className="space-y-4 rounded-xl border border-base-300 bg-base-100 p-4">
      <h2 className="font-semibold">Notes and annotations for {value.artifact.name}</h2>
      <ul className="space-y-1">{value.notes.map(note => (
        <li key={note.id}><Link className="link" to={path + '/' + note.id}>{note.title}</Link></li>
      ))}</ul>
      <div className="flex flex-wrap gap-2">
        <Link className="btn btn-sm" to={path + '/' + newId} state={{ draft: true }}
          onClick={() => setNewId(crypto.randomUUID())}>New linked note</Link>
        {!!choices.length && (
          <>
            <select className="select select-sm" aria-label="Existing note" value={selectedNote}
              onChange={event => setSelectedNote(event.target.value)}>
              <option value="">Choose an existing note</option>
              {choices.map(note => <option key={note.id} value={note.id}>{note.title}</option>)}
            </select>
            <button type="button" className="btn btn-sm" disabled={busy || !choices.some(row => row.id === selectedNote)}
              onClick={() => run(async () => {
                await call('link', selectedNote, 'artifact', artifactId);
                setSelectedNote('');
                return 'Note linked.';
              }, true)}>Link existing note</button>
          </>
        )}
      </div>
      {noteId && <OpenNote key={noteId} id={noteId} draft={Boolean(state?.draft)} artifactId={artifactId} returnTo={path}
        notes={notes ?? []} changed={changed} />}
      <ul className="space-y-2">{value.annotations.map(annotation => (
        <li key={annotation.id} className="rounded-lg bg-base-200 p-3">
          {annotation.locator && <p className="text-sm font-medium">{annotation.locator}</p>}
          <p className="whitespace-pre-wrap">{annotation.text}</p>
        </li>
      ))}</ul>
      <form className="space-y-2" onSubmit={event => {
        event.preventDefault();
        run(async () => {
          await call('addAnnotation', artifactId, text, locator);
          setText('');
          setLocator('');
          return 'Annotation added.';
        }, true);
      }}>
        <label className="grid gap-1 text-sm">Annotation
          <textarea className="textarea w-full" value={text} onChange={event => setText(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <input className="input input-sm" aria-label="Annotation locator" placeholder="Page or locator (optional)"
            value={locator} onChange={event => setLocator(event.target.value)} />
          <button type="submit" className="btn btn-sm" disabled={busy || !text.trim()}>Add annotation</button>
        </div>
      </form>
    </section>
  );
}
