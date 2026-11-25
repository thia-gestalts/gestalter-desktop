const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

class StorageClient {
  constructor([python, script]) {
    this.nextId = 0;
    this.pending = new Map();
    this.child = spawn(python, ['-I', '-B', '-c', [
      'import runpy, sys',
      'from pathlib import Path',
      'script = Path(sys.argv[1])',
      'sys.path.insert(0, str(script.parent))',
      'runpy.run_path(str(script), run_name="__main__")',
    ].join('\n'), script], {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
    });
    this.ready = new Promise((resolve, reject) => {
      this.child.once('error', reject);
      this.child.once('exit', () => reject(new Error('Local storage stopped.')));
      createInterface({ input: this.child.stdout }).on('line', (line) => {
        const { ready, id, result, error } = JSON.parse(line);
        if (ready) resolve();
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        if (error) request.reject(new Error(error));
        else request.resolve(result);
      });
    });
    this.child.on('exit', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Local storage stopped.'));
      this.pending.clear();
    });
    this.child.stdin.on('error', () => {});
  }

  async call(method, args) {
    await this.ready;
    if (this.child.exitCode !== null || this.child.signalCode !== null || !this.child.stdin.writable) {
      throw new Error('Local storage stopped.');
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, method, args }) + '\n', (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  close() {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
  }
}

module.exports = { StorageClient };
