import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve('src');
const layers = {
  dumb: [],
  entities: [],
  features: ['dumb', 'entities'],
  meta: ['dumb', 'entities', 'features'],
  pages: ['dumb', 'entities', 'features', 'meta'],
};

for (const name of fs.readdirSync(root, { recursive: true })) {
  const [layer, unit] = name.split(path.sep);
  const file = path.join(root, name);
  if (fs.statSync(file).isDirectory()) {
    if (!Object.hasOwn(layers, layer)) throw Error(`Unknown source layer: ${layer}`);
    continue;
  }
  if (!/\.[cm]?[jt]sx?$/.test(name)) continue;
  if (path.basename(name) === 'index.ts') throw Error(`Use direct exports in ${name}`);
  await build({
    entryPoints: [file],
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'layers',
      setup(builder) {
        builder.onResolve({ filter: /^\./ }, ({ path: specifier, resolveDir, kind }) => {
          if (kind === 'entry-point') return;
          const target = path.relative(root, path.resolve(resolveDir, specifier));
          const [targetLayer, targetUnit] = target.split(path.sep);
          const sameUnit = layer === targetLayer && (layer === 'dumb' || unit === targetUnit);
          if (unit && !sameUnit && !layers[layer]?.includes(targetLayer)) {
            return { errors: [{ text: `${name} cannot import ${specifier}` }] };
          }
          return { external: true };
        });
        builder.onResolve({ filter: /^[^.]/ }, ({ kind }) =>
          kind === 'entry-point' ? undefined : { external: true });
      },
    }],
  });
}
