import { InlineMarkdown } from '../../dumb/InlineMarkdown';
import { useState } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { OpenNote } from '../../features/note-edit/note-route';
import { Plus } from 'lucide-react';
import { useRead } from '../../entities/workspace/useRead';

export function Notes() {
  const { id } = useParams();
  const { state } = useLocation();
  const { revision, changed } = useOutletContext();
  const [query, setQuery] = useState('');
  const { value: found, error } = useRead('listNotes', query, revision);
  const { value: all } = useRead('listNotes', '', revision);
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  return (
    <main className="flex min-h-0 flex-1 bg-base-100">
      <aside className={`w-full flex-col border-base-300 md:flex md:w-80 md:shrink-0 md:border-e ${id ? 'hidden' : 'flex'}`} aria-label="Notes">
        <div className="flex gap-2 border-b border-base-300 p-2">
          <input className="input input-sm min-w-0 flex-1" type="search" aria-label="Search notes" placeholder="Search" value={query}
            onChange={(event) => setQuery(event.target.value)} />
          <Link to={`/notes/${newId}`} state={{ draft: true }} className="btn btn-primary btn-sm btn-square"
            title="New note" aria-label="New note" onClick={() => setNewId(crypto.randomUUID())}><Plus size={16} /></Link>
        </div>
        {error && <p role="alert">{error}</p>}
        {found && !found.length && <p className="px-2 py-3 text-sm text-base-content/65">{query ? 'No matching notes.' : 'No notes yet.'}</p>}
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {found?.map((note) => (
            <li key={note.id}><Link aria-current={note.id === id ? 'page' : undefined} to={`/notes/${note.id}`}
              className={`block truncate px-3 py-3 text-sm hover:bg-base-200 ${note.id === id ? 'bg-base-300 font-medium' : ''}`}>
              <InlineMarkdown>{note.title || '(empty)'}</InlineMarkdown>
            </Link></li>
          ))}
        </ul>
      </aside>
      {id && <div className="min-w-0 flex-1 overflow-y-auto">
        <OpenNote key={id} id={id} draft={Boolean(state?.draft)} notes={all ?? []} changed={changed} />
      </div>}
    </main>
  );
}
