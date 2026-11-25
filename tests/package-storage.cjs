const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout } = require('node:timers/promises');
const { promisify } = require('node:util');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

async function until(check, message) {
  for (let retries = 0; retries < 100; retries++) {
    if (check()) return;
    await setTimeout(20);
  }
  assert.fail(message);
}

async function shutdown(client) {
  const exited = once(client.child, 'exit');
  client.close();
  const [status] = await exited;
  assert.equal(status, 0);
}

async function main() {
  const { Window } = await import('happy-dom');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gestalter-storage-'));
  const version = require('../package.json').version;
  const deb = process.argv[2] ?? path.join(__dirname, '..', 'release', `gestalter-desktop_${version}_amd64.deb`);
  let client;
  let window;
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

    const dist = path.join(app, 'dist');
    const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
    const entry = html.match(/<script type="module"[^>]* src="([^"]+)"/)[1];
    const source = await fs.readFile(path.join(dist, entry), 'utf8');
    let flushForClose;
    const openRenderer = () => {
      window = new Window({ url: 'https://gestalter.invalid/index.html#/notes', settings: { enableJavaScriptEvaluation: true } });
      window.document.write('<div id="root"></div>');
      window.gestalter = { call, onClose(callback) { flushForClose = callback; } };
      const script = window.document.createElement('script');
      script.type = 'module';
      script.textContent = source;
      window.document.body.append(script);
    };
    openRenderer();
    const find = (selector, name) => [...window.document.querySelectorAll(selector)].find((el) => el.textContent.trim() === name);
    await until(() => find('a', 'New note'), 'The notes route did not mount.');
    find('a', 'New note').click();
    const field = () => window.document.querySelector('[aria-label="Note Markdown"]');
    await until(field, 'The new note editor did not open.');
    const type = (text) => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(field(), text);
      field().dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    type('# A packaged note\n\nFirst draft.');
    const save = find('button', 'Save');
    await until(() => !save.disabled, 'The editor did not register the Markdown edit.');
    save.click();
    await until(() => find('a', 'A packaged note'), 'The new note was not saved.');

    const picker = window.document.querySelector('input[type="file"][multiple]');
    const file = new window.File([Buffer.from(png, 'base64')], 'pixel.png', { type: 'image/png' });
    Object.defineProperty(picker, 'files', { value: [file] });
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => window.document.querySelector('img[alt="pixel.png"]'), 'The selected image was not attached.');

    const text = '# A packaged note\n\n**Persistent** Markdown.';
    type(text);
    assert.equal(await flushForClose(), true);
    await window.happyDOM.close();
    window = undefined;
    await shutdown(client);
    client = undefined;

    client = start();
    openRenderer();
    await until(() => find('a', 'A packaged note'), 'The notes route did not read SQLite.');
    find('a', 'A packaged note').click();
    await until(() => window.document.querySelector('[aria-label="Note Markdown"]')?.value === text,
      'The editor did not reopen the saved Markdown.');
    await until(() => window.document.querySelector('img[alt="pixel.png"]')?.getAttribute('src') === `data:image/png;base64,${png}`,
      'The editor did not load the saved image.');
    find('button', 'Preview').click();
    await until(() => find('strong', 'Persistent'), 'The renderer did not render Markdown.');
    find('a', 'Recent practice').click();
    await until(() => find('p', 'Round to the nearest ten'), 'The practice route did not resolve the skill label.');
    assert.equal(find('p', 'Round to the nearest ten').closest('li').querySelector('time').dateTime,
      '2025-10-09T08:53:20.000Z');
    assert.equal(find('p', 'Bézier Curves'), undefined);
    await shutdown(client);
    client = undefined;
    console.log('Packaged storage and production React bundle passed persistence checks in an emulated DOM.');
  } finally {
    await window?.happyDOM.close();
    if (client && client.child.exitCode === null) await shutdown(client);
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
