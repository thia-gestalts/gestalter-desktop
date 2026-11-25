import { useRef } from 'react';

export function FilePicker({ children, accept, multiple, disabled, onFiles }) {
  const input = useRef(null);
  return (
    <>
      <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => input.current.click()}>
        {children}
      </button>
      <input ref={input} type="file" accept={accept} multiple={multiple}
        aria-label={typeof children === 'string' ? children : undefined} hidden
        onChange={(event) => {
          const files = Array.from(event.target.files);
          event.target.value = '';
          if (files.length) void onFiles(files);
        }} />
    </>
  );
}

export function imagePayload(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error('Images must be no larger than 12 MiB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result.split(',')[1]));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}
