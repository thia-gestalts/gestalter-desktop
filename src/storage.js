export const call = (method, ...args) => window.gestalter.call(method, ...args);

let flushEditor;

export function handleWindowClose() {
  window.gestalter.onClose(() => flushEditor?.() ?? true);
}

export function registerEditorFlush(flush) {
  flushEditor = flush;
  return () => { flushEditor = undefined; };
}
