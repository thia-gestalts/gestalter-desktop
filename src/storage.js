export const account = window.gestalter.serviceOrigin ? import('./olymp.js') : Promise.resolve(null);

async function dispatch(method, args, observed) {
  const client = await account;
  return client ? client.call(method, args, observed) : window.gestalter.call(method, ...args);
}
export const call = (method, ...args) => dispatch(method, args);
export const edit = (observed, method, ...args) => dispatch(method, args, observed);

let flushEditor;

export const flushOpenEditor = () => flushEditor?.() ?? true;

export function handleWindowClose() {
  window.gestalter.onClose(flushOpenEditor);
}

export function registerEditorFlush(flush) {
  flushEditor = flush;
  return () => { flushEditor = undefined; };
}
