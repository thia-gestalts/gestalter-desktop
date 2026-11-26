let flushEditor;

export const flushOpenEditor = () => flushEditor?.() ?? true;

export function handleWindowClose() {
  window.gestalter.onClose(flushOpenEditor);
}

export function registerEditorFlush(flush) {
  flushEditor = flush;
  return () => { if (flushEditor === flush) flushEditor = undefined; };
}
