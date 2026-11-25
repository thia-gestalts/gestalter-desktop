const path = require('node:path');

function pythonCommand(app) {
  const root = app.getAppPath();
  // The Debian launcher uses the upstream executable name, so Electron can
  // report a development build even when loading its bundled resources/app.
  if (root !== path.join(process.resourcesPath, 'app') && !app.isPackaged) {
    return [process.env.GESTALTER_PYTHON || 'python3', path.join(root, 'backend', 'service.py')];
  }
  return [
    path.join(process.resourcesPath, 'python', 'bin', 'python3'),
    path.join(root, 'backend', 'service.py'),
  ];
}

module.exports = { pythonCommand };
