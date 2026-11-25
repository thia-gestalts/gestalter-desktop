// Session credentials stay in Chromium's IndexedDB. Account manifests, encrypted
// chunks and the projection used by Notes and Recent practice all live in SQLite.
const runtime = '/olymp/';
const sdk = await import(/* @vite-ignore */ runtime + 'client.js');
const { remembered } = await import(/* @vite-ignore */ runtime + 'browser.js');
const service = await window.gestalter.serviceOrigin();
const stored = await remembered.read();
export const session = stored?.origin === service ? stored : null;
const scope = session && JSON.stringify([service, session.account.id]);
const sql = (method, ...args) => window.gestalter.call('account', scope, method, args);
const lock = work => navigator.locks.request('olymp:' + scope, work);
const projectionKinds = new Set(['note', 'fact', 'skill', 'topic', 'learning-event', 'gestalter-inbox-text']);
let localNames = new Map();
let replica;

function visible(group) {
  if (group?.versions.length !== 1) return;
  const version = group.versions[0];
  const value = version.value;
  if (!version.deleted && projectionKinds.has(value?.kind) && typeof value.id === 'string'
      && value.id && sdk.recordKey(value) === group.key) return version;
}

async function save(state) {
  const previous = await sql('state');
  const before = new Map(sdk.entries(previous?.base.heads ?? []).map(g => [g.key, visible(g)]));
  const rows = [];
  for (const group of sdk.entries(state.base.heads)) {
    const old = before.get(group.key);
    const next = visible(group);
    if (JSON.stringify(old?.ids) === JSON.stringify(next?.ids)) continue;
    if (!next) {
      if (old) rows.push([old.value.kind, old.value.id, null, []]);
      continue;
    }
    const { value, files } = next;
    const images = [];
    if (value.kind === 'note') {
      const refs = value.attachments ?? [];
      if (refs.length !== files.length) throw Error('Note image references do not match its files.');
      for (const [i, ref] of refs.entries()) {
        const prior = old?.value.attachments?.findIndex(r => r.id === ref.id) ?? -1;
        if (prior !== -1 && JSON.stringify(old.files[prior]) === JSON.stringify(files[i])) continue;
        const bytes = await replica.attachment(files[i]);
        images.push({ ...ref, name: localNames.get(ref.id) ?? ref.id, data: bytes.toBase64() });
      }
    }
    rows.push([value.kind, value.id, value, images]);
  }
  await sql('save', state, rows);
  if (rows.length) window.dispatchEvent(new Event('replica-change'));
}

if (session) {
  replica = new sdk.Replica(session, {
    scope, lock, state: () => sql('state'), save,
    chunk: async id => {
      const data = await sql('chunk', id);
      return data && Uint8Array.fromBase64(data);
    },
    saveChunk: (id, bytes) => sql('saveChunk', id, bytes.toBase64()),
  }, (_, path, options) => sdk.request('', path, options));
  replica.start();
  addEventListener('pagehide', () => replica.close());
}
export const status = () => replica?.syncStatus() ?? 'Local workspace';
export async function login(name, password, signup) {
  const unlocked = await sdk.signIn('', { name, password, signup, device: 'Gestalter desktop' });
  await remembered.save({ ...unlocked, origin: service });
  location.reload();
}
export async function logout() {
  try {
    await sdk.request('', 'logout', { session, method: 'POST' });
  } catch (error) {
    if (error.status !== 401) throw error;
  }
  replica.close();
  await remembered.clear(session);
  location.reload();
}

const noteWrites = new Set(['saveNote', 'deleteNote', 'link', 'attachImage', 'detachImage', 'placeNote']);
const writes = new Set([...noteWrites, 'importPractice', 'importInbox', 'deferInbox', 'removeInbox']);
export async function call(method, args, observed) {
  if (!session || method === 'pickInboxFolder') return window.gestalter.call(method, ...args);
  if (!writes.has(method)) {
    if (method !== 'getNote') return sql(method, ...args);
    return lock(async () => {
      const note = await sql(method, ...args);
      if (note) {
        const group = sdk.entries(await replica.records()).find(g => g.key === sdk.recordKey(note));
        note.olympHeads = visible(group).ids;
      }
      return note;
    });
  }
  let result;
  let noteKey;
  let existingIds;
  let noteChangeIndex;
  const ids = await replica.writeBatch(async groups => {
    const byKey = new Map(groups.map(g => [g.key, g]));
    if (noteWrites.has(method)) {
      noteKey = sdk.recordKey({ kind: 'note', id: args[0] });
      existingIds = visible(byKey.get(noteKey))?.ids ?? [];
      if (observed && JSON.stringify(existingIds) !== JSON.stringify(observed))
        throw Error('This note changed on another device. Reopen it before editing.');
    }
    const plan = await sql('prepare', method, args);
    result = plan.result;
    localNames = new Map();
    return plan.changes.map((change, index) => {
      const key = sdk.recordKey(change);
      if (key === noteKey) noteChangeIndex = index;
      const group = byKey.get(key);
      if (group?.versions.length > 1) throw Error('This record has conflicting versions.');
      const prior = visible(group);
      const files = [];
      const attachments = [];
      for (const ref of change.value?.attachments ?? []) {
        const image = change.images[ref.id];
        if (image) {
          localNames.set(ref.id, image.name);
          attachments.push(Uint8Array.fromBase64(image.data));
        } else {
          const index = prior.value.attachments.findIndex(r => r.id === ref.id);
          files.push(prior.files[index]);
        }
      }
      return { key, value: change.value, deleted: change.value === null,
        files: change.kind === 'note' || !change.value ? files : prior?.files, attachments };
    });
  });
  if (noteKey && result) result.olympHeads = noteChangeIndex === undefined ? existingIds : [ids[noteChangeIndex]];
  return result;
}
