const fs = require('node:fs');
const path = require('node:path');

const roots = [
  'README.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  'AGENTS.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  ...walk('docs').filter((file) => file.endsWith('.md'))
];

const failures = [];

for (const file of roots) {
  const text = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const markdownLinks = [...text.matchAll(/\[[^\]]+]\(([^)]+)\)/g)].map((match) => match[1]);
  const htmlSources = [...text.matchAll(/src="([^"]+)"/g)].map((match) => match[1]);

  for (const raw of [...markdownLinks, ...htmlSources]) {
    const target = raw.split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) {
      continue;
    }

    const resolved = path.normalize(path.join(dir, target));
    if (!fs.existsSync(resolved)) {
      failures.push(`${file} -> ${raw} (${resolved})`);
    }
  }
}

if (failures.length) {
  console.error('Broken local documentation links:');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Local documentation links OK');

function walk(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}
