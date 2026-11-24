import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const resources = process.argv[2];
if (!resources) throw new Error('Expected the app Resources directory.');
mkdirSync(resources, { recursive: true });

function bundle(path) {
  return execFileSync(root + 'node_modules/.bin/esbuild', [
    path, '--bundle', '--target=safari17', '--log-level=error'
  ], { cwd: root, encoding: 'utf8' });
}

const chartScript = bundle('public/quota/quota.js').replaceAll('</script', '<\\/script');
const style = readFileSync(root + 'public/quota/quota.css', 'utf8');
const icon = 'data:image/png;base64,' + readFileSync(root + 'public/brand-zh.png').toString('base64');
const hash = value => createHash('sha256').update(value).digest('base64');
const csp = "default-src 'none'; connect-src 'none'; form-action 'none'; img-src data:; " +
  "script-src 'sha256-" + hash(chartScript) + "'; style-src 'sha256-" + hash(style) + "'";
const html = readFileSync(root + 'public/quota/index.html', 'utf8')
  .replace('connect-src \'none\'; form-action \'none\'', csp)
  .replace('<link rel="stylesheet" href="quota.css">', () => '<style>' + style + '</style>')
  .replace('<script type="module" src="quota.js"></script>', () => '')
  .replace('</body>', () => '<script>' + chartScript + '</script></body>')
  .replaceAll('../brand-zh.png', icon);
writeFileSync(resources + '/quota.html', html);
writeFileSync(resources + '/quota-model.js', bundle('apps/quota-bar/bridge-model.js'));
