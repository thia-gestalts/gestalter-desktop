const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { _electron, chromium } = require('playwright');

const firstKey = 'chen2020curves';
const secondKey = 'chen2024curves';
const account = 'sources-proof';
const password = 'sources acceptance password';
const artifactName = 'Curve Sketchbook';
const specialist = String.raw`\textsc{EU} \& research`;
const input = `@book{${firstKey}, title={${artifactName}}, year={2020}, author={Chen, Ada}}
@book{${secondKey}, title={CURVE SKETCHBOOK}, year={2024}, edition={2},
  author={Chen, Ada}, funding={${specialist}}, related={${firstKey}}}`;

async function main() {
  const serverPath = process.env.OLYMP_TEST_SERVER;
  assert.ok(serverPath, 'Set OLYMP_TEST_SERVER to a built Olymp service.');
  const vizint = path.resolve(process.env.VIZINT_ROOT ?? '../vizint');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gestalter-sources-'));
  const children = [];
  const failures = [];
  let app, browser;

  async function server(command, args, env, pattern) {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
    children.push([child, once(child, 'exit')]);
    for await (const line of createInterface({ input: child.stdout })) {
      const match = line.match(pattern);
      if (match) return match[1];
    }
    throw Error(command + ' did not start listening.');
  }

  async function credentials(page, button) {
    await page.getByLabel('Login name').fill(account);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: button, exact: true }).click();
    const status = await page.getByText(/^Fully synced at revision /).textContent();
    return Number(status.match(/\d+$/)[0]);
  }

  async function closeDesktop() {
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    app = undefined;
  }

  async function exportFile(page, file) {
    // Intercept only the picker result. The selected path is written by the real IPC handler.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async (_window, options) => {
        if (!options.filters[0].extensions.includes('bib')) throw Error('Expected a BibTeX file filter.');
        return { canceled: false, filePath };
      };
    }, file);
    await page.getByRole('button', { name: 'Export .bib' }).click();
    await page.getByText('BibTeX file exported.').waitFor();
    return fs.readFile(file, 'utf8');
  }

  try {
    const address = await server(serverPath, [], {
      OLYMP_LISTEN: '127.0.0.1:0', OLYMP_DATA: path.join(temp, 'service'),
    }, /listening on (.*)/);
    const origin = 'http://' + address;
    const vizintOrigin = await server(process.execPath, [path.join(vizint, 'scripts/serve.mjs')], {
      OLYMP_ORIGIN: origin, PORT: '0',
    }, /(https?:\/\/[^\s]+)/);

    async function startDesktop(profile) {
      const launcher = process.env.GESTALTER_TEST_LAUNCHER;
      app = await _electron.launch({
        executablePath: launcher ?? require('electron'),
        args: [...(launcher ? [] : [path.resolve(__dirname, '..')]), '--ozone-platform=x11'],
        chromiumSandbox: process.env.GESTALTER_TEST_SANDBOX !== '0',
        env: { ...process.env, OLYMP_ORIGIN: origin,
          XDG_DATA_HOME: path.join(temp, profile, 'data'), XDG_CONFIG_HOME: path.join(temp, profile, 'config') },
        timeout: 20000,
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => failures.push(error.message));
      await page.getByRole('link', { name: 'Account' }).click();
      return page;
    }

    const author = await startDesktop('author');
    assert.equal(await credentials(author, 'Create account'), 0);
    await author.getByRole('link', { name: 'Academic Sources' }).click();
    await author.getByText('Import BibTeX', { exact: true }).click();
    await author.getByLabel('Open .bib file').setInputFiles({
      name: 'editions.bib', mimeType: 'application/x-bibtex', buffer: Buffer.from(input),
    });
    await author.getByRole('button', { name: 'Keep all as separate entries' }).click();
    await author.getByText('Imported 2 entries.').waitFor();

    async function sharedArtifact(page) {
      const list = page.getByRole('list', { name: 'Artifacts' });
      await list.getByRole('link', { name: secondKey }).waitFor();
      assert.deepEqual(await list.getByRole('link').allTextContents(), [artifactName, firstKey, secondKey]);
      return list;
    }

    const artifacts = await sharedArtifact(author);
    await artifacts.getByRole('link', { name: secondKey }).click();
    await author.getByRole('button', { name: 'Edit entry' }).click();
    await author.getByLabel('edition', { exact: true }).fill('3');
    await author.getByRole('button', { name: 'Save entry' }).click();
    await author.getByText('Entry saved.').waitFor();

    // Update an existing citation from a second import and choose one conflicting field.
    await author.getByLabel('BibTeX input').fill(
      `@book{${secondKey}, title={${artifactName}}, year={2025}, keywords={geometry}}`);
    await author.getByRole('button', { name: 'Review pasted BibTeX' }).click();
    await author.getByRole('button', { name: 'Compare with ' + secondKey }).click();
    await author.getByLabel('Use other year', { exact: true }).check();
    await author.getByRole('button', { name: 'Update retained entry' }).click();
    await author.getByText('Updated the existing entry.').waitFor();

    await author.getByRole('link', { name: 'New linked note' }).click();
    const markdown = author.getByLabel('Note Markdown');
    await markdown.fill('# Compare the editions');
    await markdown.press('Control+s');
    await author.getByRole('link', { name: 'Compare the editions' }).waitFor();
    await author.getByLabel('Annotation', { exact: true }).fill('Check this proof in the first edition.');
    await author.getByLabel('Annotation locator').fill('p. 42');
    await author.getByRole('button', { name: 'Add annotation' }).click();
    await author.getByText('Annotation added.').waitFor();

    const expected = await exportFile(author, path.join(temp, 'original.bib'));
    assert.match(expected, /edition = \{3\}/);
    assert.match(expected, /year = \{2025\}/);
    assert.match(expected, /keywords = \{geometry\}/);
    assert.ok(expected.includes(`funding = {${specialist}}`));
    const published = await author.waitForFunction(async () => {
      const { remembered } = await import('/olymp/browser.js');
      const session = await remembered.read();
      const scope = JSON.stringify([session.origin, session.account.id]);
      const state = await window.gestalter.call('account', scope, 'state', []);
      return !state.pending && state.revision > 0 && state.revision;
    }).then(result => result.jsonValue());
    await closeDesktop();

    browser = await chromium.launch({ headless: true });
    const web = await browser.newPage();
    web.on('pageerror', error => failures.push(error.message));
    await web.goto(vizintOrigin + '/rounding/');
    assert.equal(await credentials(web, 'Sign in'), published);
    const readRecords = () => web.evaluate(async () => (await import('/storage.mjs')).readRecords());
    const old = await readRecords();
    await web.frameLocator('iframe').locator('#options button').first().click();
    await web.getByText('Fully synced at revision ' + (published + 1), { exact: true }).waitFor();
    const updated = await readRecords();
    assert.ok(updated.some(record => record.kind === 'learning-event' && record.type === 'attempt'));
    for (const record of old) {
      assert.deepEqual(updated.find(row => row.kind === record.kind && row.id === record.id), record);
    }

    const recovered = await startDesktop('recovered');
    assert.equal(await credentials(recovered, 'Sign in'), published + 1);
    await recovered.getByRole('link', { name: 'Academic Sources' }).click();
    const restored = await sharedArtifact(recovered);
    for (const key of [firstKey, secondKey]) {
      await restored.getByRole('link', { name: key }).click();
      const links = recovered.getByRole('region', { name: 'Notes and annotations' });
      await links.getByRole('link', { name: 'Compare the editions' }).waitFor();
      await links.getByText('p. 42', { exact: true }).waitFor();
      await links.getByText('Check this proof in the first edition.').waitFor();
    }
    assert.equal(await exportFile(recovered, path.join(temp, 'recovered.bib')), expected);
    await recovered.getByRole('link', { name: 'Recent practice' }).click();
    await recovered.getByText('Round to the nearest tenth', { exact: true }).waitFor();
    await closeDesktop();
    assert.deepEqual(failures, []);
    console.log('Two editions and one artifact survived independent editing, reconciliation input, linked notes, annotations and file export.');
    console.log('Vizint published a practice attempt while preserving both citations. A fresh desktop profile exported identical BibTeX.');
  } finally {
    if (app) {
      const closed = app.waitForEvent('close').catch(() => {});
      app.process().kill('SIGKILL');
      await closed;
    }
    await browser?.close();
    for (const [child, exited] of children.reverse()) {
      if (child.exitCode === null) child.kill();
      await exited;
    }
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
