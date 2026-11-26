import { useEffect, useState } from 'react';
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
