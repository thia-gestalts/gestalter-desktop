import { SourceConnections } from './SourceConnections';
import { ClipboardPaste, Download, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { FilePicker } from '../../dumb/native-files';
import { useToast } from '../../dumb/Toasts';
import { WorkLinks } from './WorkLinks';
import { useRead } from '../../entities/workspace/useRead';
import { call } from '../../entities/workspace/storage';

const sourcePath = id => '/sources/' + encodeURIComponent(id);

function candidate(entry, other) {
  const artifactId = entry.artifact?.id ?? entry.work?.id;
  if (artifactId === other.artifact.id || entry.citationKey.toLowerCase() === other.citationKey.toLowerCase()) return true;
  const identifier = (fields, name) => fields[name]?.trim().toLowerCase()
    .replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/, '');
  return ['doi', 'isbn', 'eprint', 'url'].some(name => {
    const value = identifier(entry.fields, name);
    return value && value === identifier(other.fields, name);
  });
}

function Compare({ current, incoming, stored, busy, onCancel, onSave }) {
  const [take, setTake] = useState({});
  const header = [
    ['key', 'Citation key', current.citationKey, incoming.citationKey],
    ['type', 'BibTeX type', current.bibtexType, incoming.bibtexType],
  ];
  const fields = [...new Set([...Object.keys(current.fields), ...Object.keys(incoming.fields)])].sort();
  const rows = [...header, ...fields.map(name => ['field:' + name, name, current.fields[name], incoming.fields[name]])];
  return (
    <section aria-label="Compare entries" className="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4">
      <h2 className="font-semibold">Compare entries</h2>
      <p className="text-sm text-base-content/70">
        Fields missing from the retained entry are filled in. Select any values you want to replace.
        {stored && ' Confirming also removes the other citation record. Both artifacts and their notes remain available.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start text-sm [&_td]:border-b [&_td]:border-base-300 [&_td]:p-2 [&_th]:p-2 [&_th]:text-start">
          <thead><tr><th>Field</th><th>Retained entry</th><th>{stored ? 'Other entry' : 'Incoming entry'}</th><th>Use other value</th></tr></thead>
          <tbody>{rows.map(([key, label, before, after]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td className="whitespace-pre-wrap break-all">{before ?? '—'}</td>
              <td className="whitespace-pre-wrap break-all">{after ?? '—'}</td>
              <td>{after !== undefined && (before === undefined ? 'Added' : before !== after &&
                <input type="checkbox" className="checkbox checkbox-sm" aria-label={'Use other ' + label}
                  checked={Boolean(take[key])} onChange={event => setTake({ ...take, [key]: event.target.checked })} />)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy}
          onClick={() => onSave(fields.filter(name => take['field:' + name]), Boolean(take.key), Boolean(take.type))}>
          {stored ? 'Reconcile and remove other entry' : 'Update retained entry'}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>Cancel comparison</button>
      </div>
    </section>
  );
}

function ImportBibtex({ entries, busy, run, incoming }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]);
  const [comparison, setComparison] = useState(null);
  const review = async input => {
    setPending([]);
    setComparison(null);
    setPending((await call('previewBibtex', input)).map((row, index) => ({ ...row, index })));
  };
  useEffect(() => {
    if (!incoming) return;
    setText(incoming.text);
    void run(async () => {
      const parsed = await call('previewBibtex', incoming.text);
      const pendingRows = [];
      const fresh = [];
      let filled = 0;
      for (const [index, row] of parsed.entries()) {
        const current = entries.find((entry) => entry.citationKey.toLowerCase() === row.citationKey.toLowerCase());
        if (!current) {
          if (entries.some((entry) => candidate(row, entry)) || parsed.some((other, at) =>
            at !== index && other.citationKey.toLowerCase() === row.citationKey.toLowerCase())) {
            pendingRows.push({ ...row, index });
          } else fresh.push(row);
          continue;
        }
        const fields = Object.keys(row.fields);
        const missing = fields.filter((name) => !current.fields[name]);
        const conflicts = current.bibtexType !== row.bibtexType || fields.some((name) =>
          current.fields[name] && current.fields[name] !== row.fields[name]);
        if (conflicts) pendingRows.push({ ...row, index });
        else if (missing.length) {
          await call('reconcileSource', current, row, missing);
          filled++;
        }
      }
      if (fresh.length) await call('importSources', fresh);
      setPending(pendingRows);
      setComparison(null);
      return `Imported ${fresh.length}. Updated ${filled}. To review ${pendingRows.length}.`;
    }, true);
  }, [incoming]);
  const finish = ids => {
    const finished = new Set(ids);
    setPending(rows => rows.filter(row => !finished.has(row.index)));
    setComparison(null);
  };
  const keep = rows => run(async () => {
    await call('importSources', rows);
    finish(rows.map(row => row.index));
    return `Imported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}.`;
  }, true);
  return (
    <details open={incoming ? true : undefined} className="border-t border-base-300 p-2">
      <summary className="cursor-pointer font-semibold">Import BibTeX</summary>
      <div className="mt-3 space-y-3">
        <textarea className="textarea min-h-28 w-full font-mono text-sm" aria-label="BibTeX input"
          placeholder="Paste BibTeX here" value={text} disabled={busy} onChange={event => {
            setText(event.target.value);
            setPending([]);
            setComparison(null);
          }} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}
            onClick={() => run(() => review(text))}>Review pasted BibTeX</button>
          <FilePicker accept=".bib,application/x-bibtex" disabled={busy} onFiles={([file]) => run(async () => {
            if (file.size > 16 * 1024 * 1024) throw Error('The BibTeX file must be no larger than 16 MiB.');
            const input = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
            setText(input);
            await review(input);
          })}>Open .bib file</FilePicker>
        </div>
        {!!pending.length && (
          <section aria-label="BibTeX import review" className="space-y-3">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => keep(pending)}>
              Keep all as separate entries
            </button>
            {pending.map(entry => {
              const matches = entries.filter(other => candidate(entry, other));
              return (
                <div key={entry.index} className="space-y-2 rounded-lg border border-base-300 p-3">
                  <p className="font-medium">{entry.work.name}</p>
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    Citation key
                    <input className="input input-sm font-mono" value={entry.citationKey} disabled={busy}
                      onChange={event => {
                        setPending(rows => rows.map(row => row.index === entry.index
                          ? { ...row, citationKey: event.target.value } : row));
                        setComparison(null);
                      }} />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => keep([entry])}>Keep as separate entry</button>
                    {matches.map(current => (
                      <button key={current.id} type="button" className="btn btn-sm" disabled={busy}
                        onClick={() => setComparison({ current, entry })}>Compare with {current.citationKey}</button>
                    ))}
                  </div>
                  {comparison?.entry.index === entry.index && (
                    <Compare key={comparison.current.id} current={comparison.current} incoming={entry} busy={busy}
                      onCancel={() => setComparison(null)} onSave={(fields, key, type) => run(async () => {
                        await call('reconcileSource', comparison.current, entry, fields, key, type);
                        finish([entry.index]);
                        return 'Updated the existing entry.';
                      }, true)} />
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </details>
  );
}

function EntryEditor({ entry, busy, cancel, onSave }) {
  const [snapshot, setSnapshot] = useState(entry);
  const [key, setKey] = useState(entry.citationKey);
  const [type, setType] = useState(entry.bibtexType);
  const [fields, setFields] = useState(entry.fields);
  const [newField, setNewField] = useState('');
  const [aliases, setAliases] = useState((entry.aliases ?? []).join('\n'));
  const [tags, setTags] = useState((entry.tags ?? []).join('\n'));
  const [extra, setExtra] = useState(entry.extra ?? '');
  const lines = (value) => value.split('\n').map((line) => line.trim()).filter(Boolean);
  const addName = newField.trim().toLowerCase();
  return (
    <form aria-label="Edit bibliographic entry" className="space-y-3" onSubmit={event => {
      event.preventDefault();
      void Promise.resolve(onSave({ citationKey: key.trim(), bibtexType: type.trim(), fields, aliases: lines(aliases), tags: lines(tags), extra }, snapshot))
        .then((saved) => { if (saved) setSnapshot(saved); });
    }}>
      <fieldset disabled={busy} className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Citation key
            <input className="input w-full font-mono" value={key} required onChange={event => setKey(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">BibTeX type
            <input className="input w-full font-mono" value={type} required onChange={event => setType(event.target.value)} />
          </label>
        </div>
        {Object.entries(fields).map(([name, value]) => (
          <div className="flex items-end gap-2" key={name}>
            <label className="grid min-w-0 flex-1 gap-1 text-sm">{name}
              <textarea className="textarea w-full font-mono" rows={value.includes('\n') ? 3 : 1}
                aria-label={name} value={value} onChange={event => setFields({ ...fields, [name]: event.target.value })} />
            </label>
            <button type="button" className="btn btn-sm" aria-label={'Remove ' + name} onClick={() => {
              setFields(Object.fromEntries(Object.entries(fields).filter(([field]) => field !== name)));
            }}>Remove</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <input className="input input-sm" aria-label="New field name" placeholder="Field name" value={newField}
            onChange={event => setNewField(event.target.value)} />
          <button type="button" className="btn btn-sm" disabled={!/^[a-z][a-z0-9_:.+/-]*$/.test(addName) || Object.hasOwn(fields, addName)}
            onClick={() => { setFields({ ...fields, [addName]: '' }); setNewField(''); }}>Add field</button>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-sm">Aliases<textarea className="textarea" value={aliases}
            onChange={(event) => setAliases(event.target.value)} /></label>
          <label className="grid gap-1 text-sm">Tags<textarea className="textarea" value={tags}
            onChange={(event) => setTags(event.target.value)} /></label>
        </div>
        <label className="grid gap-1 text-sm">Extra<textarea className="textarea" value={extra}
          onChange={(event) => setExtra(event.target.value)} /></label>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary btn-sm">Save entry</button>
          <button type="button" className="btn btn-sm" onClick={cancel}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}

function Entry({ entry, entries, busy, run }) {
  const navigate = useNavigate();
  const [editorVersion, setEditorVersion] = useState(0);
  const { toast } = useToast();
  const [otherId, setOtherId] = useState('');
  const [comparison, setComparison] = useState(null);
  const others = entries.filter(row => row.id !== entry.id);
  const matched = others.filter(row => candidate(entry, row));
  const remaining = others.filter(row => !candidate(entry, row));
  return (
    <section aria-label="Bibliographic entry" className="space-y-3 p-3">
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => {
        const removed = await call('deleteSource', entry);
        navigate(sourcePath(entry.artifact.id));
        toast(`Deleted citation ${removed.citationKey}.`, { action: { label: 'Undo', run: () => run(async () => {
          await call('restoreRecord', removed);
          navigate(sourcePath(removed.id));
        }, true) } });
      }, true)}><Trash2 size={16} /> Delete citation</button>
      <EntryEditor key={editorVersion} entry={entry} busy={busy} cancel={() => setEditorVersion((value) => value + 1)}
        onSave={async (updated, snapshot) => {
          let saved;
          await run(async () => {
            saved = await call('saveSource', snapshot, updated);
            return 'Entry saved.';
          }, true);
          return saved;
        }} />
      {!!others.length && (
        <div className="flex flex-wrap gap-2">
          <select className="select select-sm max-w-full" aria-label="Entry to compare" value={otherId}
            onChange={event => setOtherId(event.target.value)}>
            <option value="">Choose an entry to compare</option>
            {!!matched.length && <optgroup label="Possible matches">
              {matched.map(row => <option key={row.id} value={row.id}>{row.citationKey}</option>)}
            </optgroup>}
            {!!remaining.length && <optgroup label="Other entries">
              {remaining.map(row => <option key={row.id} value={row.id}>{row.citationKey}</option>)}
            </optgroup>}
          </select>
          <button type="button" className="btn btn-sm" disabled={busy || !others.some(row => row.id === otherId)}
            onClick={() => setComparison({ current: entry, other: others.find(row => row.id === otherId) })}>Compare entries</button>
        </div>
      )}
      {comparison && (
        <Compare key={comparison.other.id} current={comparison.current} incoming={comparison.other} stored busy={busy}
          onCancel={() => setComparison(null)} onSave={(fields, key, type) => run(async () => {
            await call('reconcileSource', comparison.current, comparison.other, fields, key, type, true);
            setOtherId('');
            setComparison(null);
            return 'Entries reconciled.';
          }, true)} />
      )}
    </section>
  );
}

export function Sources() {
  const { id, noteId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const { revision, changed } = useOutletContext();
  const { value, error: loadError } = useRead('sourceLibrary', undefined, revision);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const { entries, artifacts } = value ?? { entries: [], artifacts: [] };
  const selected = entries.find(row => row.id === id);
  const groups = Map.groupBy(entries, entry => entry.artifact.id);
  const artifactId = selected?.artifact.id ?? (groups.has(id) || artifacts.some(row => row.id === id) ? id : null);
  const search = query.trim().toLowerCase();
  const works = artifacts.filter(work => work.name.toLowerCase().includes(search)
    || groups.get(work.id)?.some(row => row.citationKey.toLowerCase().includes(search)));
  const exportBibtex = () => run(async () =>
    await call('saveBibtexFile', await call('exportBibtex')) ? 'BibTeX file exported.' : '');
  const run = async (work, refresh = false) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await work() ?? '');
    } catch (failure) {
      setError(failure.message);
    } finally {
      if (refresh) changed();
      setBusy(false);
    }
  };
  useEffect(() => {
    const paste = (event) => {
      const text = event.clipboardData?.getData('text/plain');
      const target = event.target;
      if (!text?.includes('@') || target?.closest?.('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      setIncoming({ text });
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, []);

  return <main className="flex min-h-0 flex-1 bg-base-100" aria-label="Academic Sources">
    <aside className={`flex w-full flex-col border-base-300 md:flex md:w-80 md:shrink-0 md:border-e ${id || creating ? 'hidden' : ''}`}>
      <div className="flex gap-2 border-b border-base-300 p-2">
        <input className="input input-sm min-w-0 flex-1" type="search" aria-label="Search sources" placeholder="Search"
          value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="btn btn-sm btn-square" aria-label="Paste BibTeX" onClick={() => run(async () => {
          setIncoming({ text: await navigator.clipboard.readText() });
        })}><ClipboardPaste size={16} /></button>
        <button type="button" className="btn btn-primary btn-sm btn-square" aria-label="New source" onClick={() => {
          navigate('/sources');
          setCreating(true);
        }}><Plus size={16} /></button>
      </div>
      {(error || loadError) && <p role="alert" className="alert alert-error">{error || loadError}</p>}
      {message && <p role="status" className="p-2 text-sm">{message}</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Citations">
        {entries.filter((entry) => [entry.citationKey, ...Object.values(entry.fields)].some((value) =>
          value.toLowerCase().includes(search))).map((entry) => (
          <li key={entry.id}><Link to={sourcePath(entry.id)} aria-current={entry.id === id ? 'page' : undefined}
            onClick={() => setCreating(false)}
            className={`block px-3 py-2 hover:bg-base-200 ${entry.id === id ? 'bg-base-300' : ''}`}>
            <span className="block truncate">{entry.fields.title || entry.citationKey}</span>
            <span className="block truncate text-xs text-base-content/60">{[entry.fields.author, entry.fields.year, entry.citationKey].filter(Boolean).join(' · ')}</span>
          </Link></li>
        ))}
        {works.filter((work) => !groups.has(work.id)).map((work) => <li key={work.id}>
          <Link className="block px-3 py-2 hover:bg-base-200" to={sourcePath(work.id)} onClick={() => setCreating(false)}>{work.name}</Link>
        </li>)}
        {value && !entries.length && !works.length && <li className="p-6 text-center text-sm text-base-content/60">{search ? 'Nothing found.' : 'No sources yet.'}</li>}
      </ul>
      <ImportBibtex entries={entries} busy={busy} run={run} incoming={incoming} />
      <button type="button" className="btn btn-ghost btn-sm self-start m-2" disabled={busy || !entries.length} onClick={exportBibtex}>
        <Download size={16} /> Export .bib
      </button>
    </aside>
    <div className={`min-w-0 flex-1 overflow-y-auto ${!id && !creating ? 'hidden md:block' : ''}`}>
      {(id || creating) && <button type="button" className="btn btn-ghost btn-sm md:hidden" onClick={() => {
        setCreating(false);
        navigate('/sources');
      }}>Back to sources</button>}
      {creating ? <div className="p-3"><EntryEditor entry={{ citationKey: '', bibtexType: 'article', fields: { title: '' } }}
        busy={busy} cancel={() => setCreating(false)} onSave={(entry) => run(async () => {
          const [created] = await call('importSources', [entry]);
          setCreating(false);
          navigate(sourcePath(created.id));
        }, true)} /></div> : <>
        {selected && <>
          <Entry key={selected.id} entry={selected} entries={entries} busy={busy} run={run} />
          {!state?.draft && !noteId && <SourceConnections key={selected.id} id={selected.id} revision={revision} changed={changed} busy={busy} run={run} />}
        </>}
        {artifactId && <WorkLinks key={artifactId} artifactId={artifactId} path={sourcePath(id)}
          revision={revision} changed={changed} busy={busy} run={run} />}
      </>}
    </div>
  </main>;
}
