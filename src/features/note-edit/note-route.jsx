import { NoteEditor } from './NoteEditor';
import { useRead } from '../../entities/workspace/useRead';

export function OpenNote({ id, draft, notes, changed, ...editorProps }) {
  const { value, error } = useRead('getNote', id);
  if (error) return <p role="alert" className="alert alert-error">{error}</p>;
  if (value === undefined) return <p className="p-8 text-base-content/65">Loading note…</p>;
  if (value === null && !draft) return <p className="p-8">This note is unavailable.</p>;
  return <NoteEditor id={id} initial={value} notes={notes} onChanged={changed} {...editorProps} />;
}
