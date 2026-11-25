const path = require('node:path');

function pythonCommand(app) {
  const root = app.getAppPath();
  if (!app.isPackaged) {
    return [process.env.GESTALTER_PYTHON || 'python3', path.join(root, 'backend', 'service.py')];
  }
  return [
    path.join(process.resourcesPath, 'python', 'bin', 'python3'),
    path.join(root, 'backend', 'service.py'),
  ];
}

module.exports = { pythonCommand };
