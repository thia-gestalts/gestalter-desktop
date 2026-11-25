import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router-dom';
import { ImagePlus, Save, Trash2, Unlink } from 'lucide-react';
import Markdown from 'react-markdown';
import { FilePicker, imagePayload } from './native-files';
import { call, edit, registerEditorFlush } from './storage';

function Image({ image, disabled, onRemove }) {
  const [src, setSrc] = useState('');
  const [unavailable, setUnavailable] = useState(!image.name);
  useEffect(() => {
    if (!image.name) return;
    let current = true;
    call('getImage', image.id).then(
      (uri) => { if (current) setSrc(uri); },
      () => { if (current) setUnavailable(true); },
    );
    return () => { current = false; };
  }, [image.id, image.name]);
  return (
    <figure className="min-w-0 rounded-lg border border-base-300 p-2">
      {src && !unavailable && <img src={src} alt={image.name} className="h-32 w-full object-contain"
        onError={() => setUnavailable(true)} />}
      {unavailable && <p>Image unavailable</p>}
      <figcaption className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate">{image.name ?? image.id}</span>
        <button type="button" className="btn btn-ghost btn-square btn-sm" aria-label="Remove image"
          disabled={disabled} onClick={onRemove}><Trash2 size={16} /></button>
      </figcaption>
    </figure>
  );
}

export function NoteEditor({ id, initial, onChanged, notes }) {
  const navigate = useNavigate();
  const [note, setNote] = useState(initial);
  const [text, setText] = useState(initial?.text ?? '');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saved = useRef(initial);
  const draft = useRef(initial?.text ?? '');
  const queue = useRef(Promise.resolve(true));
  const dirty = () => draft.current !== (saved.current?.text ?? '');
  const blocker = useBlocker(() => dirty() || (saved.current !== null && busy));

  const updateNote = useCallback((next) => {
    saved.current = next;
    setNote(next);
    onChanged();
  }, [onChanged]);

  const enqueue = useCallback((work) => {
    setBusy(true);
    const run = queue.current.then(async () => {
      try {
        setError('');
        await work();
        return true;
      } catch (failure) {
        setError(failure.message);
        return false;
      }
    });
    queue.current = run;
    void run.then(() => { if (queue.current === run) setBusy(false); });
    return run;
  }, []);

  const save = useCallback(async () => {
    const value = draft.current;
    if (value === (saved.current?.text ?? '') || (!saved.current && !value.trim())) return;
    updateNote(await edit(saved.current?.olympHeads, 'saveNote', id, value, !saved.current));
  }, [id, updateNote]);

  const flush = useCallback(() => enqueue(save), [enqueue, save]);

  useLayoutEffect(() => registerEditorFlush(flush), [flush]);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void flush().then((success) => success ? blocker.proceed() : blocker.reset());
  }, [blocker, flush]);

  const mutate = (work) => enqueue(async () => {
    await save();
    if (!saved.current) throw new Error('Write some Markdown to create the note first.');
    await work();
  });

  const attach = (files) => mutate(async () => {
    for (const file of files) updateNote(await edit(saved.current?.olympHeads, 'attachImage', id, file.name, await imagePayload(file)));
  });

  const remove = async () => {
    const removed = await enqueue(async () => {
      await edit(saved.current?.olympHeads, 'deleteNote', id);
      draft.current = '';
      updateNote(null);
    });
    setConfirmDelete(false);
    if (removed) navigate('/notes');
  };
  const choices = notes.filter((candidate) => candidate.id !== id
    && !note?.related.some((ref) => ref.kind === 'note' && ref.id === candidate.id));

  return (
    <section className="min-w-0 space-y-5 p-5 md:p-8" aria-label="Note editor">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/notes" className="btn btn-ghost btn-sm md:hidden">All notes</Link>
        <div className="join">
          <button type="button" className={`btn btn-sm join-item ${!preview ? 'btn-active' : ''}`}
            aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button>
          <button type="button" className={`btn btn-sm join-item ${preview ? 'btn-active' : ''}`}
            aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-base-content/65" role="status">
            {busy ? 'Saving…' : text !== (note?.text ?? '') ? 'Unsaved' : note ? 'Saved' : ''}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={flush}
            disabled={busy || !dirty()}><Save size={16} /> Save</button>
          {note && <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete</button>}
        </div>
      </div>
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
          {dirty() && <button type="button" className="btn btn-sm" onClick={() => {
            draft.current = saved.current?.text ?? '';
            setText(draft.current);
            setError('');
          }}>Discard draft changes</button>}
        </div>
      )}
      {confirmDelete && (
        <div role="alertdialog" aria-label="Delete note" className="alert">
          <span>Permanently delete this note?</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button type="button" className="btn btn-error btn-sm" disabled={busy} onClick={remove}>Delete note</button>
          </div>
        </div>
      )}
      {preview ? (
        <div className="markdown min-h-58 rounded-xl border border-base-300 bg-base-100 p-4" aria-label="Markdown preview">
          <Markdown skipHtml disallowedElements={['img', 'a']} unwrapDisallowed>{text || 'Nothing to preview yet.'}</Markdown>
        </div>
      ) : (
        <textarea className="textarea min-h-58 w-full resize-y rounded-xl font-mono text-sm leading-relaxed"
          aria-label="Note Markdown" placeholder={'# Note title\n\nWrite in Markdown…'} value={text}
          onChange={(event) => { draft.current = event.target.value; setText(draft.current); }}
          onBlur={() => { if (dirty()) void flush(); }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 's') {
              event.preventDefault();
              void flush();
            }
          }} />
      )}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Images</h2>
          <FilePicker accept="image/png,image/jpeg,image/gif,image/webp" multiple onFiles={attach}><ImagePlus size={16} /> Attach images</FilePicker>
        </div>
        {!!note?.attachments.length && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {note.attachments.map((image) => (
              <Image key={image.id} image={image} disabled={busy}
                onRemove={() => mutate(async () => updateNote(await edit(saved.current?.olympHeads, 'detachImage', id, image.id)))} />
            ))}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Related records</h2>
        {!!note?.related.length && (
          <ul className="space-y-1">
            {note.related.map((ref) => (
              <li key={JSON.stringify([ref.kind, ref.id])} className="flex items-center justify-between gap-2">
                {ref.kind === 'note' && ref.label
                  ? <Link className="link" to={`/notes/${ref.id}`}>{ref.label}</Link>
                  : <span className="break-all">{ref.label ?? `Unavailable · ${ref.id}`}</span>}
                <button type="button" className="btn btn-ghost btn-square btn-sm" aria-label="Remove relationship"
                  disabled={busy} onClick={() => mutate(async () => updateNote(await edit(saved.current?.olympHeads, 'link', id, ref.kind, ref.id, true)))}>
                  <Unlink size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!!choices.length && (
          <div className="flex gap-2">
            <select className="select select-sm" aria-label="Related note" value={target}
              onChange={(event) => setTarget(event.target.value)}>
              <option value="">Choose a note</option>
              {choices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
            <button type="button" className="btn btn-sm" disabled={!target || busy} onClick={() => mutate(async () => {
              updateNote(await edit(saved.current?.olympHeads, 'link', id, 'note', target));
              setTarget('');
            })}>Link note</button>
          </div>
        )}
      </section>
    </section>
  );
}
