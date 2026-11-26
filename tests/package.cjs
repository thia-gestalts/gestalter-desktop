const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { _electron } = require('playwright');

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);

async function close(app) {
  const exited = app.waitForEvent('close', { timeout: 10000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gestalter-package-'));
  const version = require('../package.json').version;
  const deb = process.argv[2] ?? path.join(__dirname, '..', 'release', `gestalter-desktop_${version}_amd64.deb`);
  let app;
  try {
    let executablePath = process.env.GESTALTER_TEST_LAUNCHER;
    if (!executablePath) {
      const install = path.join(temp, 'install');
      await promisify(execFile)('dpkg-deb', ['-x', deb, install]);
      executablePath = path.join(install, 'usr', 'bin', 'gestalter');
    }
    const env = {
      ...process.env,
      XDG_DATA_HOME: path.join(temp, 'data'),
      XDG_CONFIG_HOME: path.join(temp, 'config'),
      GESTALTER_PYTHON: '/unused-in-the-package',
    };
    const start = () => _electron.launch({
      executablePath, env, timeout: 15000, chromiumSandbox: process.env.GESTALTER_TEST_SANDBOX !== '0',
      args: ['--ozone-platform=x11'],
    });
    app = await start();
    let page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.getByText('No notes yet.').waitFor();
    await page.getByRole('link', { name: 'Recent practice' }).click();
    await page.getByText('No practice recorded yet.').waitFor();
    const fixture = await fs.readFile(path.join(__dirname, 'fixtures', 'records.json'));
    const records = JSON.parse(fixture);
    const importFile = page.locator('input[accept=".json,application/json"]');
    await importFile.setInputFiles({
      name: 'engagement.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(records.filter(({ kind, type }) => kind === 'topic' || type === 'engagement'))),
    });
    await page.getByText('Learner records imported.').waitFor();
    await page.getByText('No practice recorded yet.').waitFor();
    await importFile.setInputFiles({ name: 'records.json', mimeType: 'application/json', buffer: fixture });
    const skill = page.getByText('Round to the nearest ten', { exact: true });
    await skill.waitFor();
    assert.equal(await skill.locator('xpath=ancestor::li').locator('time').getAttribute('datetime'),
      '2025-10-09T08:53:20.000Z');
    assert.equal(await page.getByText('Bézier Curves', { exact: true }).isVisible(), false);

    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    await page.getByRole('link', { name: 'New note' }).click();
    const field = page.getByRole('textbox', { name: 'Note Markdown' });
    await field.fill('# Rounding notes\n\nA **Markdown** note.');
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.locator('strong').getByText('Markdown').waitFor();
    await page.getByRole('link', { name: 'Rounding notes' }).waitFor();
    await page.locator('input[type=file][multiple]').setInputFiles({
      name: 'pixel.png', mimeType: 'image/png', buffer: png,
    });
    await page.getByRole('img', { name: 'pixel.png' }).waitFor();
    await page.waitForFunction(() => document.querySelector('img[alt="pixel.png"]')?.naturalWidth === 1);
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    const updated = '# Rounding notes\n\nSaved **on close**.';
    await field.fill(updated);
    await close(app);
    app = undefined;
    await fs.access(path.join(env.XDG_DATA_HOME, 'gestalter', 'learner.sqlite3'));
    assert.deepEqual(failures, []);

    app = await start();
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => failures.push(error.message));
    await page.getByRole('searchbox').fill('on close');
    await page.getByRole('link', { name: 'Rounding notes' }).click();
    const reopened = page.getByRole('textbox', { name: 'Note Markdown' });
    assert.equal(await reopened.locator(':scope > .cm-line').allTextContents().then((lines) => lines.join('\n')), updated);
    const image = page.getByRole('img', { name: 'pixel.png' });
    assert.equal(await image.getAttribute('src'), `data:image/png;base64,${png.toString('base64')}`);
    await page.getByRole('button', { name: 'Remove image' }).click();
    await image.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete note' }).click();
    await page.getByText('No matching notes.').waitFor();
    await page.getByRole('link', { name: 'Recent practice' }).click();
    await page.getByText('Round to the nearest ten', { exact: true }).waitFor();
    await page.getByText('The two nearest multiples of ten to 47 are 40 and 50.', { exact: true }).waitFor();
    await close(app);
    app = undefined;
    assert.deepEqual(failures, []);
    console.log('Extracted package passed note CRUD, image restart, and pinned practice checks.');
  } finally {
    if (app) {
      const exited = app.waitForEvent('close').catch(() => {});
      app.process().kill('SIGKILL');
      await exited;
    }
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
