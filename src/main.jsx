import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Link, NavLink, Navigate, Outlet, RouterProvider, useLocation,
  useOutletContext, useParams } from 'react-router-dom';
import { Activity, NotebookPen, Plus, Search } from 'lucide-react';
import { FilePicker } from './native-files';
import { NoteEditor } from './NoteEditor';
import { call, handleWindowClose } from './storage';
import './style.css';

function Frame() {
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((value) => value + 1), []);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const importRecords = async ([file]) => {
    setImporting(true);
    setError('');
    setMessage('');
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('The records file must be no larger than 16 MiB.');
      const count = await call('importPractice', await file.text());
      setMessage(count ? 'Learner records imported.' : 'No practice records found in this file.');
      changed();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setImporting(false);
    }
  };
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-base-300 bg-base-100 px-4 py-2 md:px-6">
        <Link to="/notes" className="flex items-center gap-2 text-lg font-semibold"><NotebookPen size={20} /> Gestalter</Link>
        <nav className="flex gap-1" aria-label="Workspace">
          <NavLink to="/notes" className="nav-link">Notes</NavLink>
          <NavLink to="/practice" className="nav-link">Recent practice</NavLink>
        </nav>
        <div className="ml-auto">
          <FilePicker accept=".json,application/json" disabled={importing} onFiles={importRecords}>Import practice records</FilePicker>
        </div>
      </header>
      {error && <p role="alert" className="alert alert-error">{error}</p>}
      {message && <p role="status" className="px-6 pt-3 text-sm">{message}</p>}
      <Outlet context={{ revision, changed }} />
    </>
  );
}

function useRead(method, arg, revision = 0) {
  const [result, setResult] = useState({ value: undefined, error: '' });
  useEffect(() => {
    let current = true;
    call(method, ...(arg === undefined ? [] : [arg])).then(
      (value) => { if (current) setResult({ value, error: '' }); },
      (failure) => { if (current) setResult({ value: null, error: failure.message }); },
    );
    return () => { current = false; };
  }, [method, arg, revision]);
  return result;
}

function OpenNote({ id, draft, notes, changed }) {
  const { value, error } = useRead('getNote', id);
  if (error) return <p role="alert" className="alert alert-error">{error}</p>;
  if (value === undefined) return <p className="p-8 text-base-content/65">Loading note…</p>;
  if (value === null && !draft) return <p className="p-8">This note is unavailable.</p>;
  return <NoteEditor id={id} initial={value} notes={notes} onChanged={changed} />;
}

function Notes() {
  const { id } = useParams();
  const { state } = useLocation();
  const { revision, changed } = useOutletContext();
  const [query, setQuery] = useState('');
  const { value: found, error } = useRead('listNotes', query, revision);
  const { value: all } = useRead('listNotes', '', revision);
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  return (
    <main className="grid min-h-[calc(100vh-3.5rem)] md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={`border-base-300 bg-base-100 px-4 py-5 md:block md:border-r ${id ? 'hidden' : ''}`}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Notes</h1>
          <Link to={`/notes/${newId}`} state={{ draft: true }} className="btn btn-primary btn-sm"
            onClick={() => setNewId(crypto.randomUUID())}><Plus size={16} /> New note</Link>
        </div>
        <label className="input input-sm mb-3 w-full">
          <Search size={16} aria-hidden />
          <input type="search" aria-label="Search notes" placeholder="Search notes" value={query}
            onChange={(event) => setQuery(event.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        {found && !found.length && <p className="px-2 py-3 text-sm text-base-content/65">{query ? 'No matching notes.' : 'No notes yet.'}</p>}
        <ul className="space-y-1">
          {found?.map((note) => (
            <li key={note.id}><Link aria-current={note.id === id ? 'page' : undefined} to={`/notes/${note.id}`}
              className={`block truncate rounded-md px-3 py-2 text-sm hover:bg-base-200 ${note.id === id ? 'bg-base-300 font-medium' : ''}`}>
              {note.title}
            </Link></li>
          ))}
        </ul>
      </aside>
      {id ? <OpenNote key={id} id={id} draft={Boolean(state?.draft)} notes={all ?? []} changed={changed} />
        : <div className="hidden place-items-center text-base-content/65 md:grid">Select a note or create one.</div>}
    </main>
  );
}

function Practice() {
  const { revision } = useOutletContext();
  const { value: rows, error } = useRead('recentPractice', undefined, revision);
  return (
    <main className="mx-auto max-w-4xl px-5 py-8 md:px-8">
      <h1 className="mb-5 flex items-center gap-3 text-2xl font-semibold"><Activity size={22} /> Recent practice</h1>
      {error && <p role="alert" className="alert alert-error">{error}</p>}
      {rows?.length === 0 && <p className="rounded-xl border border-base-300 bg-base-100 p-5 text-base-content/65">No practice recorded yet.</p>}
      {!!rows?.length && (
        <ul className="divide-y divide-base-300 rounded-xl border border-base-300 bg-base-100">
          {rows.map((row) => {
            const date = new Date(row.occurredAtMs);
            return (
              <li key={JSON.stringify([row.kind, row.id])} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <div>
                  <p className="text-xs capitalize text-base-content/65">{row.kind}</p>
                  <p className="font-medium">{row.label}</p>
                </div>
                {Number.isNaN(date.getTime()) ? <span>{row.occurredAtMs} ms UTC</span>
                  : <time className="text-sm text-base-content/70" dateTime={date.toISOString()}>{date.toLocaleString()}</time>}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

const router = createHashRouter([{
  element: <Frame />,
  children: [
    { index: true, element: <Navigate to="/notes" replace /> },
    { path: 'notes/:id?', element: <Notes /> },
    { path: 'practice', element: <Practice /> },
    { path: '*', element: <Navigate to="/notes" replace /> },
  ],
}]);

handleWindowClose();
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
