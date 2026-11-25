const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { _electron } = require('playwright');

const deferredObservations = /01-observations\.txt\s*Deferred/;
const fullySynced = /^Fully synced at revision /;

async function main() {
  const serverPath = process.env.OLYMP_TEST_SERVER;
  assert.ok(serverPath, 'Set OLYMP_TEST_SERVER to a built Olymp service.');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gestalter-workflows-'));
  const source = path.join(temp, 'source');
  const children = new Set();
  const failures = [];
  const server = spawn(serverPath, [], {
    env: { ...process.env, OLYMP_LISTEN: '127.0.0.1:0', OLYMP_DATA: path.join(temp, 'service') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stopped = once(server, 'exit');
  let address;
  try {
    for await (const line of createInterface({ input: server.stdout })) {
      const match = line.match(/listening on (.*)/);
      if (!match) continue;
      address = match[1];
      break;
    }
    assert.ok(address, 'Olymp did not start.');
    const launcher = process.env.GESTALTER_TEST_LAUNCHER;
    const start = async (profile) => {
      const app = await _electron.launch({
        executablePath: launcher ?? require('electron'),
        args: [...(launcher ? [] : [path.resolve(__dirname, '..')]), '--ozone-platform=x11'],
        chromiumSandbox: true,
        env: { ...process.env, OLYMP_ORIGIN: 'http://' + address,
          XDG_DATA_HOME: path.join(temp, profile, 'data'), XDG_CONFIG_HOME: path.join(temp, profile, 'config') },
        timeout: 15000,
      });
      children.add(app);
      const page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => failures.push(error.message));
      return { app, page };
    };
    const close = async ({ app }) => {
      const exited = app.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await exited;
      children.delete(app);
    };
    const signIn = async (page, button) => {
      await page.getByRole('link', { name: 'Account' }).click();
      await page.getByLabel('Login name').fill('inbox-proof');
      await page.getByLabel('Password').fill('inbox acceptance password');
      await page.getByRole('button', { name: button, exact: true }).click();
      await page.getByText(fullySynced).waitFor();
    };

    await fs.mkdir(path.join(source, 'nested'), { recursive: true });
    const sources = {
      '01-observations.txt': Buffer.from('Café: observations for two notes.\n'),
      '02-later.md': Buffer.from('Revisit this text later.'),
      'blank.txt': Buffer.from('  \n'),
      'binary.txt': Buffer.from([65, 0, 66]),
      'invalid.txt': Buffer.from([0xc0, 0x80]),
      'nested/ignored.txt': Buffer.from('Nested text'),
    };
    for (const [name, bytes] of Object.entries(sources)) await fs.writeFile(path.join(source, name), bytes);
    await fs.symlink('01-observations.txt', path.join(source, 'linked.txt'));
    const author = await start('author');
    const { page } = author;
    await signIn(page, 'Create account');
    // The dialog return value is injected. Reading the selected directory and saving it use real IPC.
    await author.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async (_window, options) => {
        if (!options.properties.includes('openDirectory')) throw Error('Expected a directory picker.');
        return { canceled: false, filePaths: [folder] };
      };
    }, source);
    await page.getByRole('link', { name: 'Plaintext inbox' }).click();
    const importFolder = page.getByRole('button', { name: 'Import folder' });
    await importFolder.click();
    await page.getByText('Imported 2. Already in inbox 0. Skipped 4.').waitFor();
    await page.getByText('blank.txt · Empty text.', { exact: true }).waitFor();
    await page.getByText('invalid.txt · Content is not UTF-8.', { exact: true }).waitFor();
    await page.getByText('binary.txt · Contains binary control characters.', { exact: true }).waitFor();
    await page.getByText('linked.txt · Not a regular file.', { exact: true }).waitFor();
    assert.equal(await page.getByText('ignored.txt', { exact: true }).count(), 0);
    await importFolder.click();
    await page.getByText('Imported 0. Already in inbox 2. Skipped 4.').waitFor();
    await page.getByText('Café: observations for two notes.').waitFor();

    const field = page.getByLabel('Note Markdown');
    const notes = page.getByRole('region', { name: 'Notes from this text' });
    for (const label of ['First observation', 'Second observation']) {
      await page.getByRole('link', { name: 'New note from text' }).click();
      await field.fill('# ' + label);
      await field.press('Control+s');
      await notes.getByRole('link', { name: label }).waitFor();
    }
    await field.fill('# Second observation\n\nUpdated in the shared editor.');
    await field.press('Control+s');
    await page.getByText('Saved', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Defer', exact: true }).click();
    await page.getByText('Revisit this text later.').waitFor();
    await page.getByRole('link', { name: deferredObservations }).click();
    await notes.getByRole('link', { name: 'First observation' }).click();
    await page.getByRole('link', { name: 'Place in Zettelkasten' }).click();
    await page.getByRole('button', { name: 'Make root' }).click();
    const outline = (view) => view.getByRole('region', { name: 'Outline' });
    await outline(page).getByRole('link', { name: /First observation\s*Root/ }).waitFor();
    await page.getByRole('link', { name: 'Second observation', exact: true }).click();
    await page.getByLabel('Placement target').selectOption({ label: 'First observation' });
    await page.getByRole('button', { name: 'Place after', exact: true }).click();
    await outline(page).getByRole('link', { name: 'Second observation' }).waitFor();
    await page.getByRole('link', { name: 'New note', exact: true }).click();
    await field.fill('# Side thought');
    await field.press('Control+s');
    const placement = page.getByRole('region', { name: 'Zettelkasten placement' });
    await placement.getByRole('button', { name: 'Exclude', exact: true }).click();
    await placement.getByRole('button', { name: 'Include again' }).click();
    await page.getByLabel('Placement target').selectOption({ label: 'First observation' });
    const synced = (view) => view.waitForFunction(async () => {
      const { remembered } = await import('/olymp/browser.js');
      const session = await remembered.read();
      const scope = JSON.stringify([session.origin, session.account.id]);
      const state = await window.gestalter.call('account', scope, 'state', []);
      return state && !state.pending && state.revision > 0 ? state.revision : false;
    }).then((result) => result.jsonValue());
    await page.getByRole('button', { name: 'Branch from', exact: true }).click();
    await outline(page).getByRole('link', { name: /Side thought/ }).waitFor();
    const revision = await synced(page);
    await close(author);

    async function verify(view, withImport) {
      await view.getByRole('link', { name: 'Zettelkasten' }).click();
      await outline(view).getByRole('link', { name: /Side thought/ }).waitFor();
      assert.deepEqual(await outline(view).getByRole('link').allTextContents(),
        ['First observationRoot', '↳ Side thought', 'Second observation']);
      await outline(view).getByRole('link', { name: 'Second observation' }).click();
      await view.getByRole('region', { name: 'Zettelkasten placement' }).getByText(/follows/).waitFor();
      assert.match(await view.getByLabel('Note Markdown').inputValue(), /Updated in the shared editor/);
      await view.getByRole('link', { name: 'Plaintext inbox' }).click();
      const item = view.getByRole('link', { name: deferredObservations });
      if (withImport) {
        await item.click();
        await view.getByText('Café: observations for two notes.').waitFor();
        const links = view.getByRole('region', { name: 'Notes from this text' }).getByRole('link');
        assert.deepEqual(await links.allTextContents(), ['First observation', 'Second observation']);
      } else {
        await view.getByText('Revisit this text later.').waitFor();
        await item.waitFor({ state: 'detached' });
      }
    }
    const restarted = await start('author');
    await verify(restarted.page, true);
    await close(restarted);
    console.log('Folder import, two notes from one text, and Zettelkasten placements survived restart.');

    const peer = await start('peer');
    await signIn(peer.page, 'Sign in');
    await peer.page.getByText('Fully synced at revision ' + revision, { exact: true }).waitFor();
    await verify(peer.page, true);
    await peer.page.getByRole('button', { name: 'Remove imported text' }).click();
    await peer.page.getByRole('button', { name: 'Remove copy' }).click();
    await peer.page.getByRole('link', { name: deferredObservations }).waitFor({ state: 'detached' });
    assert.ok(await synced(peer.page) > revision);
    await close(peer);
    const returned = await start('author');
    await verify(returned.page, false);
    await close(returned);
    for (const [name, bytes] of Object.entries(sources)) assert.deepEqual(await fs.readFile(path.join(source, name)), bytes);
    assert.equal(await fs.readlink(path.join(source, 'linked.txt')), '01-observations.txt');
    assert.deepEqual(failures, []);
    console.log('A fresh Olymp profile received the inbox, note links, root, follower and branch. Its removal synced back.');
  } finally {
    for (const app of children) {
      const exited = app.waitForEvent('close').catch(() => {});
      app.process().kill('SIGKILL');
      await exited;
    }
    if (server.exitCode === null) server.kill();
    await stopped;
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
