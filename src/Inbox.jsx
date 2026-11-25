import { useState } from 'react';
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { OpenNote, useRead } from './note-route';
import { call, flushOpenEditor } from './storage';

const route = '/inbox';

export function Inbox() {
  const { itemId, id } = useParams();
  const { state } = useLocation();
  const { revision, changed } = useOutletContext();
  const { value: items, error: listError } = useRead('listInbox', undefined, revision);
  const current = itemId ?? items?.[0]?.id;
  const { value: item, error: itemError } = useRead('getInboxItem', current ?? null, revision);
  const { value: notes } = useRead('listNotes', '', revision);
  const navigate = useNavigate();
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);

  const run = async (work) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const importFolder = () => run(async () => {
    const folder = await call('pickInboxFolder');
    if (!folder) return;
    const result = await call('importInbox', folder.files);
    setReport({ ...result, skipped: folder.skipped });
    changed();
  });

  const leave = (method) => run(async () => {
    if (!await flushOpenEditor()) return;
    await call(method, current);
    const next = items?.find((entry) => entry.id !== current);
    setConfirmRemove(null);
    changed();
    navigate(next ? `${route}/${next.id}` : route, { replace: true });
  });

  const itemPath = `${route}/${current}`;
  return (
    <main className="grid min-h-[calc(100vh-3.5rem)] md:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]">
      <aside className="min-w-0 space-y-5 border-base-300 bg-base-100 px-4 py-5 md:border-r">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Plaintext inbox</h1>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={importFolder}>Import folder</button>
        </div>
        {(error || listError || itemError) && <p role="alert" className="alert alert-error">{error || listError || itemError}</p>}
        {report && <div className="text-sm">
          <p role="status">Imported {report.added}. Already in inbox {report.duplicates}. Skipped {report.skipped.length}.</p>
          {report.skipped.length > 0 && <ul className="mt-2 list-disc pl-5">
            {report.skipped.map(({ name, reason }) => <li key={name}>{name} · {reason}</li>)}
          </ul>}
        </div>}
        {items?.length === 0 && <p className="text-sm text-base-content/65">The inbox is empty.</p>}
        {items?.length > 0 && (
          <ul className="max-h-44 space-y-1 overflow-auto border-b border-base-300 pb-3" aria-label="Imported texts">
            {items.map((entry) => <li key={entry.id}>
              <Link to={`${route}/${entry.id}`} aria-current={entry.id === current ? 'page' : undefined}
                className={`block break-all rounded-md px-3 py-2 text-sm hover:bg-base-200 ${entry.id === current ? 'bg-base-300 font-medium' : ''}`}>
                {entry.name}{entry.deferredAt != null && <span className="ml-2 text-xs text-base-content/65">Deferred</span>}
              </Link>
            </li>)}
          </ul>
        )}
        {current && item === null && <p className="text-sm text-base-content/65">This imported text is unavailable.</p>}
        {item && <section className="space-y-3" aria-label="Imported text">
          <h2 className="break-all font-semibold">{item.name}</h2>
          <div className="flex flex-wrap gap-2">
            <Link to={`${itemPath}/${newId}`} state={{ draft: true }} className="btn btn-primary btn-sm"
              onClick={() => setNewId(crypto.randomUUID())}>New note from text</Link>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => leave('deferInbox')}>Defer</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirmRemove(current)}>Remove imported text</button>
          </div>
          {confirmRemove === current && <div role="alertdialog" aria-label="Remove imported text" className="space-y-2">
            <p>Remove this copy from the inbox?</p>
            <button type="button" className="btn btn-sm mr-2" onClick={() => setConfirmRemove(null)}>Cancel</button>
            <button type="button" className="btn btn-error btn-sm" disabled={busy} onClick={() => leave('removeInbox')}>Remove copy</button>
          </div>}
          <pre className="max-h-[55vh] overflow-auto rounded-lg bg-base-200 p-3 font-sans text-sm whitespace-pre-wrap wrap-break-word">{item.text}</pre>
          {item.notes.length > 0 && <section aria-labelledby="inbox-notes-heading">
            <h3 id="inbox-notes-heading" className="font-semibold">Notes from this text</h3>
            <ul className="space-y-1">
              {item.notes.map((note) => <li key={note.id}>
                <Link to={`${itemPath}/${note.id}`} className="link" aria-current={note.id === id ? 'page' : undefined}>{note.title}</Link>
              </li>)}
            </ul>
          </section>}
        </section>}
      </aside>
      {item && id && (state?.draft || item.notes.some((note) => note.id === id)) ? (
        <OpenNote key={`${current}/${id}`} id={id} draft={Boolean(state?.draft)} notes={notes ?? []} changed={changed}
          inboxId={current} returnTo={itemPath}
          renderActions={({ note }) => note && <Link className="btn btn-sm" to={`/zettelkasten/${id}`}>Place in Zettelkasten</Link>} />
      ) : (
        <p className="p-8 text-base-content/65">Select a note from an imported text or create one.</p>
      )}
    </main>
  );
}
