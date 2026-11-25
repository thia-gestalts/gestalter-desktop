import { useState } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { FilePicker } from './native-files';
import { OpenNote, useRead } from './note-route';
import { call } from './storage';

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
        <table className="table table-sm">
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

function ImportBibtex({ entries, busy, run }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]);
  const [comparison, setComparison] = useState(null);
  const review = async input => {
    setPending([]);
    setComparison(null);
    setPending((await call('previewBibtex', input)).map((row, index) => ({ ...row, index })));
  };
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
    <details className="rounded-xl border border-base-300 bg-base-100 p-4">
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
  const [key, setKey] = useState(entry.citationKey);
  const [type, setType] = useState(entry.bibtexType);
  const [fields, setFields] = useState(entry.fields);
  const [newField, setNewField] = useState('');
  const addName = newField.trim().toLowerCase();
  return (
    <form aria-label="Edit bibliographic entry" className="space-y-3" onSubmit={event => {
      event.preventDefault();
      onSave({ citationKey: key.trim(), bibtexType: type.trim(), fields });
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
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary btn-sm">Save entry</button>
          <button type="button" className="btn btn-sm" onClick={cancel}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}

function Entry({ entry, entries, busy, run }) {
  const [editing, setEditing] = useState(null);
  const [otherId, setOtherId] = useState('');
  const [comparison, setComparison] = useState(null);
  const others = entries.filter(row => row.id !== entry.id);
  const matched = others.filter(row => candidate(entry, row));
  const remaining = others.filter(row => !candidate(entry, row));
  return (
    <section aria-label="Bibliographic entry" className="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4">
      {editing ? <EntryEditor entry={editing} busy={busy} cancel={() => setEditing(null)} onSave={updated => run(async () => {
        await call('saveSource', editing, updated);
        setEditing(null);
        return 'Entry saved.';
      }, true)} /> : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-mono font-semibold">{entry.citationKey}</h2>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => {
              setComparison(null);
              setEditing(entry);
            }}>Edit entry</button>
          </div>
          <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            {[['BibTeX type', entry.bibtexType], ...Object.entries(entry.fields)].map(([name, value]) => (
              <div key={name} className="contents"><dt className="break-all font-medium">{name}</dt>
                <dd className="whitespace-pre-wrap break-words">{value}</dd></div>
            ))}
          </dl>
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
        </>
      )}
    </section>
  );
}

function WorkLinks({ artifactId, path, revision, changed, busy, run }) {
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

export function Sources() {
  const { id } = useParams();
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
      if (refresh) changed();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const displayWork = (workId, name) => (
    <li key={workId} className="space-y-1 rounded-lg p-2 hover:bg-base-200">
      <Link className="font-medium break-words" to={sourcePath(workId)} aria-current={id === workId ? 'page' : undefined}>{name}</Link>
      <ul className="space-y-1 pl-3">{groups.get(workId)?.map(entry => (
        <li key={entry.id}><Link className="link break-all font-mono text-sm" to={sourcePath(entry.id)}
          aria-current={id === entry.id ? 'page' : undefined}>{entry.citationKey}</Link></li>
      ))}</ul>
    </li>
  );
  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 md:px-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Academic Sources</h1>
        <button type="button" className="btn btn-sm" disabled={busy || !entries.length} onClick={exportBibtex}>Export .bib</button>
      </div>
      {(error || loadError) && <p role="alert" className="alert alert-error">{error || loadError}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      <ImportBibtex entries={entries} busy={busy} run={run} />
      <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="space-y-2 rounded-xl border border-base-300 bg-base-100 p-3">
          <h2 className="font-semibold">Artifacts</h2>
          <input className="input input-sm w-full" type="search" aria-label="Search sources" placeholder="Search titles and keys"
            value={query} onChange={event => setQuery(event.target.value)} />
          <ul aria-label="Artifacts">
            {works.map(work => displayWork(work.id, work.name))}
            {[...groups.keys()].filter(key => !artifacts.some(work => work.id === key)
              && groups.get(key).some(entry => entry.citationKey.toLowerCase().includes(search)))
              .map(key => displayWork(key, 'Unavailable artifact'))}
          </ul>
          {value && !artifacts.length && !entries.length && <p className="text-sm text-base-content/65">No sources yet.</p>}
        </aside>
        <div className="min-w-0 space-y-4">
          {selected && <Entry key={selected.id} entry={selected} entries={entries} busy={busy} run={run} />}
          {artifactId ? <WorkLinks key={artifactId} artifactId={artifactId} path={sourcePath(id)}
            revision={revision} changed={changed} busy={busy} run={run} />
            : id ? <Link className="btn btn-sm" to="/sources">Back to artifacts</Link>
              : !!entries.length && <p className="p-3 text-base-content/65">Select an artifact or citation.</p>}
        </div>
      </div>
    </main>
  );
}
