const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

async function shutdown(client) {
  const exited = once(client.child, 'exit');
  client.close();
  const [status] = await exited;
  assert.equal(status, 0);
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gestalter-storage-'));
  const version = require('../package.json').version;
  const deb = process.argv[2] ?? path.join(__dirname, '..', 'release', `gestalter-desktop_${version}_amd64.deb`);
  let client;
  try {
    process.env.XDG_DATA_HOME = path.join(temp, 'data');
    await promisify(execFile)('dpkg-deb', ['-x', deb, temp]);
    const resources = path.join(temp, 'opt', 'gestalter', 'resources');
    const app = path.join(resources, 'app');
    const { StorageClient } = require(path.join(app, 'desktop', 'client.cjs'));
    const start = () => new StorageClient([
      path.join(resources, 'python', 'bin', 'python3'),
      path.join(app, 'backend', 'service.py'),
    ]);
    const call = (method, ...args) => client.call(method, args);
    client = start();
    assert.deepEqual(await call('listNotes'), []);
    assert.deepEqual(await call('recentPractice'), []);
    const records = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'records.json'), 'utf8'));
    await call('importPractice', JSON.stringify(records.filter(({ kind, type }) => kind === 'topic' || type === 'engagement')));
    assert.deepEqual(await call('recentPractice'), []);
    await call('importPractice', JSON.stringify(records));

    const noteId = randomUUID();
    const text = '# A packaged note\n\n**Persistent** Markdown.';
    await call('saveNote', noteId, { text, title: 'Packaged title' }, true);
    const image = (await call('attachImage', noteId, 'pixel.png', png)).attachments[0];
    await shutdown(client);

    client = start();
    assert.deepEqual(await call('listNotes'), [{ id: noteId, title: 'Packaged title' }]);
    assert.equal((await call('getNote', noteId)).text, text);
    assert.equal(await call('getImage', image.id), `data:image/png;base64,${png}`);
    const practice = await call('recentPractice');
    assert.equal(practice.find((row) => row.kind === 'skill').label, 'Round to the nearest ten');
    assert.ok((await call('learningHistory')).some((row) =>
      row.type === 'engagement' && row.targets.some((target) => target.label === 'Bézier Curves')));
    await shutdown(client);
    client = undefined;
    console.log('Packaged storage passed restart checks for notes, images, and learning events.');
  } finally {
    if (client && client.child.exitCode === null) await shutdown(client);
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
