import { registerEditorFlush } from './editorFlush';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router-dom';
import { ImagePlus, Save, Trash2, Unlink } from 'lucide-react';
import { MarkdownEditor } from '../../dumb/MarkdownEditor';
import { NoteCard } from './NoteCard';
import { FilePicker, imagePayload } from '../../dumb/native-files';
import { useToast } from '../../dumb/Toasts';
import { useRead } from '../../entities/workspace/useRead';
import { call, edit } from '../../entities/workspace/storage';

const fields = (note) => ({
  title: typeof note?.title === 'string' ? note.title : '',
  text: typeof note?.text === 'string' ? note.text : '',
  extra: typeof note?.extra === 'string' ? note.extra : '',
  aliases: note?.aliases ?? [],
  tags: note?.tags ?? [],
});

function ListField({ label, values, onChange }) {
  const [input, setInput] = useState('');
  return <div className="flex flex-wrap items-center gap-2">
    <span className="font-medium">{label}</span>
    {values.map((value, index) => <button key={index} type="button" className="btn btn-sm"
      aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((_, item) => item !== index))}>{value} ×</button>)}
    <input className="input input-sm" aria-label={`Add ${label.toLowerCase()}`} value={input}
      onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
        if (event.key !== 'Enter' || !input.trim()) return;
        event.preventDefault();
        onChange([...new Set([...values, input.trim()])]);
        setInput('');
      }} />
  </div>;
}

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

export function NoteEditor({ id, initial, onChanged, notes, inboxId, artifactId, returnTo = '/notes' }) {
  const navigate = useNavigate();
  const [note, setNote] = useState(initial);
  const [values, setValues] = useState(() => fields(initial));
  const { title, text, extra, aliases, tags } = values;
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const { value: results } = useRead('linkTargets', target ? target : undefined);
  const { toast } = useToast();
  const saved = useRef(initial);
  const draft = useRef(fields(initial));
  const change = (field, value) => {
    draft.current = { ...draft.current, [field]: value };
    setValues(draft.current);
  };
  const queue = useRef(Promise.resolve(true));
  const dirty = () => JSON.stringify(draft.current) !== JSON.stringify(fields(saved.current));
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
    const previous = fields(saved.current);
    const patch = Object.fromEntries(Object.entries(draft.current)
      .filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(previous[field])));
    if (!Object.keys(patch).length || (!saved.current && !Object.values(patch).some((value) =>
      Array.isArray(value) ? value.length : value.trim()))) return;
    const args = [id, patch, !saved.current];
    if (!saved.current && (inboxId || artifactId)) args.push(inboxId ?? null, artifactId ?? null);
    updateNote(await edit(saved.current?.olympHeads, 'saveNote', ...args));
  }, [id, inboxId, artifactId, updateNote]);

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
    let removed;
    const success = await enqueue(async () => {
      removed = await edit(saved.current?.olympHeads, 'deleteNote', id);
      draft.current = fields(null);
      setValues(draft.current);
      updateNote(null);
    });
    if (!success) return;
    navigate(returnTo);
    toast('Note deleted.', { action: { label: 'Undo', run: async () => {
      await call('restoreRecord', removed.record, removed.images);
      onChanged();
      navigate(`${returnTo}/${id}`);
    } } });
  };
  const related = note?.related.filter((ref) => !['follows', 'branches from'].includes(ref.relation)) ?? [];
  const choices = notes.filter((candidate) => candidate.id !== id
    && !related.some((ref) => ref.kind === 'note' && ref.id === candidate.id));

  return (
    <section className="min-w-0 space-y-3 p-3 text-sm" aria-label="Note editor" onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void flush();
      }
    }}>
      <div className="flex flex-wrap items-center gap-2">
        {returnTo === '/notes' && <Link to="/notes" className="btn btn-ghost btn-sm md:hidden">All notes</Link>}
        <div className="join">
          <button type="button" className={`btn btn-sm ${!preview ? 'btn-active' : ''}`}
            aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button>
          <button type="button" className={`btn btn-sm ${preview ? 'btn-active' : ''}`}
            aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-base-content/65" role="status">
            {busy ? 'Saving…' : dirty() ? 'Unsaved' : note ? 'Saved' : ''}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={flush}
            disabled={busy || !dirty()}><Save size={16} /> Save</button>
          {note && <button type="button" className="btn btn-ghost btn-sm"
            disabled={busy} onClick={remove}><Trash2 size={16} /> Delete</button>}
        </div>
      </div>
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
          {dirty() && <button type="button" className="btn btn-sm" onClick={() => {
            draft.current = fields(saved.current);
            setValues(draft.current);
            setError('');
          }}>Discard draft changes</button>}
        </div>
      )}
      {!preview && <input className="input input-sm w-full" aria-label="Title" placeholder="Title" value={title}
        autoFocus onChange={(event) => change('title', event.target.value)} onBlur={() => { if (dirty()) void flush(); }} />}
      {preview ? (
        <div aria-label="Markdown preview"><NoteCard note={values} /></div>
      ) : (
        <MarkdownEditor label="Note Markdown" hint="Main" value={text}
          onChange={(value) => change('text', value)} onBlur={() => { if (dirty()) void flush(); }}
          onFiles={attach} search={(query) => choices.filter((candidate) =>
            candidate.title.toLowerCase().includes(query.toLowerCase())).slice(0, 20)}
          onOpen={(target) => { if (notes.some((candidate) => candidate.id === target)) navigate(`/notes/${target}`); }} />
      )}
      {!preview && <>
        <MarkdownEditor label="Extra" hint="Extra" compact value={extra}
          onChange={(value) => change('extra', value)} onBlur={() => { if (dirty()) void flush(); }} />
        <ListField label="Aliases" values={aliases} onChange={(next) => { change('aliases', next); void flush(); }} />
        <ListField label="Tags" values={tags} onChange={(next) => { change('tags', next); void flush(); }} />
      </>}
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
        {!!related.length && (
          <ul className="space-y-1">
            {related.map((ref) => (
              <li key={JSON.stringify([ref.kind, ref.id])} className="flex items-center justify-between gap-2">
                {ref.label && ['note', 'artifact'].includes(ref.kind)
                  ? <Link className="link" to={`/${ref.kind === 'note' ? 'notes' : 'sources'}/${encodeURIComponent(ref.id)}`}>{ref.label}</Link>
                  : <span className="break-all">{ref.label ?? `Unavailable · ${ref.id}`}</span>}
                <input className="input input-sm" aria-label={`Relationship to ${ref.label ?? ref.id}`}
                  placeholder="Related" defaultValue={ref.relation ?? ''} key={ref.relation ?? ''}
                  onBlur={(event) => {
                    const relation = event.currentTarget.value.trim();
                    if (relation !== (ref.relation ?? '')) void mutate(async () =>
                      updateNote(await edit(saved.current?.olympHeads, 'link', id, ref.kind, ref.id, false, relation)));
                  }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
                <button type="button" className="btn btn-ghost btn-square btn-sm" aria-label="Remove relationship"
                  disabled={busy} onClick={() => mutate(async () => updateNote(await edit(saved.current?.olympHeads, 'link', id, ref.kind, ref.id, true)))}>
                  <Unlink size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-col gap-1">
          <span>Link a record</span>
          <input className="input input-sm" type="search" value={target} placeholder="Search notes, sources, and topics"
            onChange={(event) => setTarget(event.target.value)} />
        </label>
        {target && <ul className="max-h-48 overflow-y-auto">
          {results?.filter((candidate) => (candidate.kind !== 'note' || candidate.id !== id)
            && !related.some((ref) => ref.kind === candidate.kind && ref.id === candidate.id))
            .map((candidate) => <li key={`${candidate.kind}:${candidate.id}`}>
              <button type="button" className="w-full px-2 py-1 text-start hover:bg-base-200" disabled={busy}
                onClick={() => mutate(async () => {
                  updateNote(await edit(saved.current?.olympHeads, 'link', id, candidate.kind, candidate.id));
                  setTarget('');
                })}>{candidate.label} <span className="text-xs text-base-content/60">{candidate.kind}</span></button>
            </li>)}
        </ul>}
      </section>
    </section>
  );
}
