import { flushOpenEditor } from '../../features/note-edit/editorFlush';
import { Clock, FolderUp, Plus, Trash2 } from 'lucide-react';
import { InlineMarkdown } from '../../dumb/InlineMarkdown';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { OpenNote } from '../../features/note-edit/note-route';
import { useRead } from '../../entities/workspace/useRead';
import { call } from '../../entities/workspace/storage';

const route = '/inbox';

export function Inbox() {
  const { itemId, id } = useParams();
  const { state } = useLocation();
  const { revision, changed } = useOutletContext();
  const { value: items, error: listError } = useRead('listInbox', undefined, revision);
  const [drawn, setDrawn] = useState();
  const current = itemId ?? (items?.some((entry) => entry.id === drawn) ? drawn : undefined);
  useEffect(() => {
    if (current || !items?.length) return;
    setDrawn(items[Math.floor(Math.random() * items.length)].id);
  }, [current, items]);
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
    setNewId(crypto.randomUUID());
    changed();
    navigate(next ? `${route}/${next.id}` : route, { replace: true });
  });

  const itemPath = `${route}/${current}`;
  useEffect(() => {
    if (current && item === null) navigate(route, { replace: true });
  }, [current, item, items, navigate]);

  const upload = <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={importFolder}>
    <FolderUp size={16} /> Import folder
  </button>;

  return <main className="flex min-h-0 flex-1 flex-col" aria-label="Plaintext inbox">
    <div className="flex items-center gap-2 border-b border-base-300 p-2">
      <span className="min-w-0 flex-1 truncate font-semibold">{item?.name}</span>
      {items && <span className="text-sm text-base-content/60">{items.length} left</span>}
      {upload}
    </div>
    {(error || listError || itemError) && <p role="alert" className="alert alert-error">{error || listError || itemError}</p>}
    {report && <div className="border-b border-base-300 p-2 text-sm">
      <p role="status">Imported {report.added}. Already in inbox {report.duplicates}. Skipped {report.skipped.length}.</p>
      {!!report.skipped.length && <ul>{report.skipped.map(({ name, reason }) => <li key={name}>{name} · {reason}</li>)}</ul>}
    </div>}
    {items?.length === 0 && <div className="flex flex-1 flex-col items-center justify-center gap-3 text-base-content/60">
      <p>The inbox is empty.</p>{upload}
    </div>}
    {item && <div className="grid min-h-0 flex-1 md:grid-cols-2">
      <div className="flex min-h-0 flex-col border-base-300 md:border-e">
        <div className="flex gap-2 border-b border-base-300 p-2">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => leave('deferInbox')}><Clock size={16} /> Defer</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmRemove(current)}><Trash2 size={16} /> Delete</button>
        </div>
        {confirmRemove === current && <div role="alertdialog" aria-label="Delete imported text" className="alert">
          <p>Delete this copy from the inbox?</p>
          <button type="button" className="btn btn-sm" onClick={() => setConfirmRemove(null)}>Cancel</button>
          <button type="button" className="btn btn-error btn-sm" disabled={busy} onClick={() => leave('removeInbox')}>Delete copy</button>
        </div>}
        <pre className="min-h-0 flex-1 overflow-y-auto p-3 font-sans whitespace-pre-wrap wrap-break-word">{item.text}</pre>
        {!!item.notes.length && <section aria-label="Notes from this text" className="border-t border-base-300 p-2">
          <h3 className="font-semibold">Notes from this text</h3>
          <ul>{item.notes.map((note) => <li key={note.id}>
            <Link className="link" to={`${itemPath}/${note.id}`} aria-current={note.id === id ? 'page' : undefined}>
              <InlineMarkdown>{note.title || '(empty)'}</InlineMarkdown>
            </Link>
          </li>)}</ul>
        </section>}
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="flex justify-end border-b border-base-300 p-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => {
            navigate(`${itemPath}/${crypto.randomUUID()}`, { state: { draft: true } });
          }}><Plus size={16} /> New note</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <OpenNote key={`${current}/${id ?? newId}`} id={id ?? newId} draft={!id || Boolean(state?.draft)}
            notes={notes ?? []} changed={changed} inboxId={current} returnTo={itemPath} />
        </div>
      </div>
    </div>}
  </main>;
}
