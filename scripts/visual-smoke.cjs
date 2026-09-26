// Renders every view with deterministic mock data, checks layout invariants, and saves screenshots to release/visual/.
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const WIDTH = Number(process.env.SMOKE_WIDTH || 1440);
const HEIGHT = Number(process.env.SMOKE_HEIGHT || 900);
const VIEWS = [
  { label: 'Overview', selector: '.gauge-grid' },
  { label: 'Agents', selector: '.data-table .session-cell' },
  { label: 'Processes', selector: '.data-table .name-cell' },
  { label: 'Services', selector: '.data-table .name-cell' },
  { label: 'Network', selector: '.data-table .name-cell' },
  { label: 'Cleanup', selector: '.action-bar' },
  { label: 'Settings', selector: '.settings-card' }
];
const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'matrix', label: 'Matrix' }
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      partition: `visual-smoke-${Date.now()}`
    }
  });

  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });

  await win.loadFile(path.join(__dirname, '../out/renderer/index.html'));
  await wait(900);

  const outputDir = path.join(__dirname, '../release/visual');
  mkdirSync(outputDir, { recursive: true });
  const run = (code) => win.webContents.executeJavaScript(code);
  const capture = async (name) => {
    win.webContents.invalidate();
    await wait(450);
    const image = await win.webContents.capturePage();
    writeFileSync(path.join(outputDir, `${name}.png`), image.toPNG());
  };

  for (const theme of THEMES) {
    await openView(run, 'Settings');
    await run(`[...document.querySelectorAll('.theme-swatch')].find((node) => node.textContent.includes(${JSON.stringify(theme.label)}))?.click()`);
    await wait(250);
    const applied = await run(`document.querySelector('.app')?.dataset.theme`);
    if (applied !== theme.id) throw new Error(`Theme ${theme.id} was not applied (got ${applied}).`);

    for (const view of VIEWS) {
      await openView(run, view.label);
      await verifyView(run, view, theme.id);
      if (view.label === 'Processes' || view.label === 'Network' || view.label === 'Services') {
        await run(`document.querySelector('.data-table')?.focus(); document.querySelector('.dt-row')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
      }
      await capture(`${theme.id}-${view.label.toLowerCase()}`);
    }
  }

  // Light theme extras: process tree, command palette, and the stop sheet.
  await openView(run, 'Settings');
  await run(`[...document.querySelectorAll('.theme-swatch')].find((node) => node.textContent.includes('Light'))?.click()`);
  await openView(run, 'Processes');
  await run(`[...document.querySelectorAll('.segmented button')].find((node) => node.textContent.includes('Tree'))?.click()`);
  await wait(200);
  const treeIndent = await run(`Math.max(...[...document.querySelectorAll('.dt-row .name-cell')].map((node) => parseFloat(node.style.paddingLeft || '0')))`);
  if (!(treeIndent > 0)) throw new Error('Tree view did not indent child processes.');
  await capture('light-processes-tree');

  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))`);
  await wait(200);
  await run(`(() => { const input = document.querySelector('.palette-input input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'claude'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(150);
  const paletteRows = await run(`document.querySelectorAll('.palette-list button').length`);
  if (!paletteRows) throw new Error('Command palette returned no results for "claude".');
  await capture('light-command-palette');
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))`);
  await wait(150);

  await openView(run, 'Agents');
  await run(`[...document.querySelectorAll('.inspector .btn')].find((node) => node.textContent.includes('Stop Session'))?.click()`);
  await wait(300);
  const sheet = await run(`Boolean(document.querySelector('.sheet'))`);
  if (!sheet) throw new Error('Stop session sheet did not open.');
  await capture('light-stop-sheet');

  if (errors.length) {
    throw new Error(`Renderer logged errors:\n${errors.join('\n')}`);
  }

  console.log(`Visual smoke passed. Screenshots in ${outputDir}`);
  app.quit();
}

async function openView(run, label) {
  const found = await run(`(() => {
    const item = [...document.querySelectorAll('.sidebar-item')].find((node) => node.querySelector('.sidebar-label')?.textContent === ${JSON.stringify(label)});
    item?.click();
    return Boolean(item);
  })()`);
  if (!found) throw new Error(`Sidebar item ${label} not found.`);
  await wait(250);
}

async function verifyView(run, view, theme) {
  const result = await run(`(() => {
    const app = document.querySelector('.app');
    const content = document.querySelector('.content');
    const text = document.body.innerText || '';
    const toolbarTitle = document.querySelector('.toolbar-title h1')?.textContent;
    const bodyOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const color = getComputedStyle(document.querySelector('.toolbar-title h1')).color;
    const background = getComputedStyle(content).backgroundColor;
    return {
      mounted: Boolean(app && content),
      hasSelector: Boolean(document.querySelector(${JSON.stringify(view.selector)})),
      toolbarTitle,
      bodyOverflow,
      cssLeak: text.includes('{') && text.includes('--'),
      undefinedText: /\\bundefined\\b|\\bNaN\\b/.test(text),
      color,
      background
    };
  })()`);

  const problems = [];
  if (!result.mounted) problems.push('app not mounted');
  if (!result.hasSelector) problems.push(`missing ${view.selector}`);
  if (result.toolbarTitle !== view.label) problems.push(`toolbar title "${result.toolbarTitle}"`);
  if (result.bodyOverflow) problems.push('page scrolls horizontally');
  if (result.cssLeak) problems.push('CSS text leaked into the page');
  if (result.undefinedText) problems.push('"undefined" or "NaN" rendered');
  if (contrast(parseColor(result.color), parseColor(result.background)) < 4.5) problems.push(`low title contrast ${result.color} on ${result.background}`);

  if (problems.length) {
    throw new Error(`${view.label} (${theme}) failed: ${problems.join('; ')}`);
  }
}

function parseColor(value) {
  const parts = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 1];
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

function luminance({ r, g, b }) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground, background) {
  // Blend a translucent foreground over the background before measuring.
  const blended = {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a)
  };
  const [light, dark] = [luminance(blended), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
