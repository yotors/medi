import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${root}.cache/ms-playwright`;
const { chromium } = await import('@playwright/test');
let failures = 0;
function check(label, ok) {
  console.log(`${ok ? 'OK' : 'MISSING'} ${label}`);
  if (!ok) failures++;
}
check(`Node ${process.version}`, Number(process.versions.node.split('.')[0]) >= 22);
const pkg = JSON.parse(readFileSync(`${root}package.json`));
for (const [name, version] of Object.entries(pkg.devDependencies)) {
  const path = `${root}node_modules/${name}/package.json`;
  check(`${name}@${version}`, existsSync(path) && JSON.parse(readFileSync(path)).version === version);
}
check('Chromium executable', existsSync(chromium.executablePath()));
check('BMad runtime', existsSync(`${root}_bmad/_config/manifest.yaml`));
check('Impeccable skill', existsSync(`${root}.agents/skills/impeccable/SKILL.md`));
check('Project MCP configuration', existsSync(`${root}.codex/config.toml`));
check('Local uv runtime', existsSync(`${root}.venv/bin/uv`));
const dir = `${root}.agents/skills`;
console.log(`Installed skill directories: ${existsSync(dir) ? readdirSync(dir).length : 0}`);
const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 10000 });
console.log(docker.status === 0 ? `OK Docker ${docker.stdout.trim()}` : 'UNAVAILABLE Docker daemon (container checks need Docker access)');
console.log('Product, authenticated journeys, observability, deployment and capacity: not configured.');
process.exitCode = failures ? 1 : 0;
