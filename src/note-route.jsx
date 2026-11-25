import { useEffect, useState } from 'react';
import { NoteEditor } from './NoteEditor';
import { call } from './storage';

export function useRead(method, arg, revision = 0) {
  const [result, setResult] = useState({ value: undefined, error: '' });
  useEffect(() => {
    let current = true;
    call(method, ...(arg === undefined ? [] : [arg])).then(
      (value) => { if (current) setResult({ arg, value, error: '' }); },
      (failure) => { if (current) setResult({ arg, value: null, error: failure.message }); },
    );
    return () => { current = false; };
  }, [method, arg, revision]);
  return result.arg === arg ? result : {};
}

export function OpenNote({ id, draft, notes, changed, ...editorProps }) {
  const { value, error } = useRead('getNote', id);
  if (error) return <p role="alert" className="alert alert-error">{error}</p>;
  if (value === undefined) return <p className="p-8 text-base-content/65">Loading note…</p>;
  if (value === null && !draft) return <p className="p-8">This note is unavailable.</p>;
  return <NoteEditor id={id} initial={value} notes={notes} onChanged={changed} {...editorProps} />;
}
