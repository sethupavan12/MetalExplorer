const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

async function main() {
  await app.whenReady();

  const win = new BrowserWindow({
    width: 1440,
    height: 760,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#07090b',
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      partition: `visual-smoke-${Date.now()}`
    }
  });

  await win.loadFile(path.join(__dirname, '../out/renderer/index.html'));
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const outputDir = path.join(__dirname, '../release');
  mkdirSync(outputDir, { recursive: true });

  const pages = ['Dashboard', 'Processes', 'Services', 'Cleanup', 'Network', 'Settings'];
  const themes = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Graphite Dark' },
    { id: 'matrix', label: 'Matrix' }
  ];

  for (const theme of themes) {
    await selectTheme(win, theme.label);

    for (const label of pages) {
      await openPage(win, label);
      await verifyAppShell(win, label);
      await verifyFilterToggle(win, label);
      await verifyScroll(win, label);
      await verifyReadableText(win, label, theme.id);
      await resetScrollForCapture(win);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const image = await win.webContents.capturePage();
      const filename = theme.id === 'light' ? `visual-smoke-${label.toLowerCase()}.png` : `visual-smoke-${theme.id}-${label.toLowerCase()}.png`;
      writeFileSync(path.join(outputDir, filename), image.toPNG());
    }
  }

  app.quit();
}

async function resetScrollForCapture(win) {
  await win.webContents.executeJavaScript(`
    for (const selector of ['.dashboard', '.overview', '.settings-panel', '.table-scroll', '.inspector-scroll']) {
      const element = document.querySelector(selector);
      if (element) element.scrollTop = 0;
    }
  `);
}

async function verifyAppShell(win, label) {
  const shell = await win.webContents.executeJavaScript(`
    (() => {
      const bodyText = document.body.innerText || '';
      const dashboardHeader = document.querySelector('.health-briefing, .command-center');
      const dashboardHeaderRect = dashboardHeader?.getBoundingClientRect();
      return {
        mounted: Boolean(document.querySelector('.app-frame')),
        dashboardHeaderHeight: dashboardHeaderRect ? Math.round(dashboardHeaderRect.height) : null,
        cssLeak:
          bodyText.includes('.process-cell') ||
          bodyText.includes('.network-remote') ||
          bodyText.includes('-webkit-line-clamp')
      };
    })();
  `);

  if (!shell.mounted || shell.cssLeak) {
    throw new Error(`App shell smoke failed for ${label}: ${JSON.stringify(shell)}`);
  }

  if (label === 'Dashboard' && (!shell.dashboardHeaderHeight || shell.dashboardHeaderHeight < 110)) {
    throw new Error(`Dashboard header smoke failed for ${label}: ${JSON.stringify(shell)}`);
  }
}

async function openPage(win, label) {
  await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent && button.textContent.includes(${JSON.stringify(label)}))
      ?.click();
  `);
  await new Promise((resolve) => setTimeout(resolve, 350));
}

async function selectTheme(win, themeLabel) {
  await openPage(win, 'Settings');
  await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('.theme-option')]
      .find((button) => button.textContent && button.textContent.includes(${JSON.stringify(themeLabel)}))
      ?.click();
  `);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent && button.textContent.includes('Save Settings'))
      ?.click();
  `);
  await new Promise((resolve) => setTimeout(resolve, 450));
}

async function verifyScroll(win, label) {
  const scrollCheck = await win.webContents.executeJavaScript(`
    (() => {
      const content = document.querySelector('.dashboard, .overview, .settings-panel, .table-panel');
      const tableScroll = document.querySelector('.table-scroll');
      const activeScroll = tableScroll || content;
      if (!content || !activeScroll) {
        return { ok: false, reason: 'missing scroll container' };
      }

      const gridRow = getComputedStyle(content).gridRowStart;
      const rect = activeScroll.getBoundingClientRect();

      return {
        ok: true,
        gridRow,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + Math.min(rect.height / 2, rect.height - 24)),
        before: activeScroll.scrollTop,
        scrollHeight: activeScroll.scrollHeight,
        clientHeight: activeScroll.clientHeight
      };
    })();
  `);
  if (!scrollCheck.ok || scrollCheck.gridRow !== '4') {
    throw new Error(`Scroll smoke failed for ${label}: ${JSON.stringify(scrollCheck)}`);
  }

  if (scrollCheck.scrollHeight > scrollCheck.clientHeight) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: scrollCheck.x, y: scrollCheck.y });
    for (let index = 0; index < 3; index += 1) {
      win.webContents.sendInputEvent({ type: 'mouseWheel', x: scrollCheck.x, y: scrollCheck.y, deltaY: -900, wheelTicksY: -9 });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const afterScrollTop = await win.webContents.executeJavaScript(`
    (() => {
      const content = document.querySelector('.dashboard, .overview, .settings-panel, .table-panel');
      const tableScroll = document.querySelector('.table-scroll');
      const activeScroll = tableScroll || content;
      const after = activeScroll?.scrollTop ?? null;
      if (activeScroll) activeScroll.scrollTop = 0;
      return after;
    })();
  `);
  const shouldScroll = label === 'Processes';
  if (
    (scrollCheck.scrollHeight > scrollCheck.clientHeight && afterScrollTop <= scrollCheck.before) ||
    (shouldScroll && scrollCheck.scrollHeight <= scrollCheck.clientHeight)
  ) {
    throw new Error(`Scroll smoke failed for ${label}: ${JSON.stringify({ ...scrollCheck, afterScrollTop })}`);
  }
}

async function verifyFilterToggle(win, label) {
  const shouldHaveFilters = !['Dashboard', 'Settings'].includes(label);
  const before = await win.webContents.executeJavaScript(`
    (() => ({
      button: Boolean(document.querySelector('.filter-toggle')),
      bar: Boolean(document.querySelector('.filter-bar'))
    }))();
  `);

  if (!shouldHaveFilters) {
    if (before.button || before.bar) {
      throw new Error(`Filter smoke failed for ${label}: ${JSON.stringify(before)}`);
    }
    return;
  }

  if (!before.button || before.bar) {
    throw new Error(`Filter smoke failed for ${label}: ${JSON.stringify(before)}`);
  }

  await win.webContents.executeJavaScript(`document.querySelector('.filter-toggle')?.click();`);
  await new Promise((resolve) => setTimeout(resolve, 120));

  const open = await win.webContents.executeJavaScript(`
    (() => {
      const bar = document.querySelector('.filter-bar');
      return {
        button: Boolean(document.querySelector('.filter-toggle.active')),
        bar: Boolean(bar),
        groups: bar ? bar.querySelectorAll('.filter-group').length : 0
      };
    })();
  `);

  if (!open.button || !open.bar || open.groups !== 3) {
    throw new Error(`Filter open smoke failed for ${label}: ${JSON.stringify(open)}`);
  }

  await win.webContents.executeJavaScript(`document.querySelector('.filter-toggle')?.click();`);
  await new Promise((resolve) => setTimeout(resolve, 120));

  const closed = await win.webContents.executeJavaScript(`
    (() => ({
      button: Boolean(document.querySelector('.filter-toggle.active')),
      bar: Boolean(document.querySelector('.filter-bar'))
    }))();
  `);

  if (closed.button || closed.bar) {
    throw new Error(`Filter close smoke failed for ${label}: ${JSON.stringify(closed)}`);
  }
}

async function verifyReadableText(win, label, themeId) {
  const failures = await win.webContents.executeJavaScript(`
    (() => {
      function parseColor(value) {
        const match = value.match(/rgba?\\(([^)]+)\\)/);
        if (!match) return null;
        const parts = match[1]
          .replace(/\\//g, ' ')
          .split(/[\\s,]+/)
          .filter(Boolean)
          .map((part) => Number.parseFloat(part.trim()));
        const [r, g, b] = parts;
        const a = Number.isFinite(parts[3]) ? parts[3] : 1;
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
        return { r, g, b, a };
      }

      function luminance(channel) {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      }

      function contrast(foreground, background) {
        const fg = 0.2126 * luminance(foreground.r) + 0.7152 * luminance(foreground.g) + 0.0722 * luminance(foreground.b);
        const bg = 0.2126 * luminance(background.r) + 0.7152 * luminance(background.g) + 0.0722 * luminance(background.b);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      }

      function blend(top, bottom) {
        const alpha = top.a + bottom.a * (1 - top.a);
        if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 };
        return {
          r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
          g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
          b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
          a: alpha
        };
      }

      function effectiveBackground(element) {
        const colors = [];
        let current = element;
        while (current) {
          const color = parseColor(getComputedStyle(current).backgroundColor);
          if (color && color.a > 0) {
            colors.push(color);
          }
          current = current.parentElement;
        }

        let background = parseColor(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
        for (let index = colors.length - 1; index >= 0; index -= 1) {
          background = blend(colors[index], background);
        }
        return background;
      }

      return [...document.querySelectorAll('body *')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const hasDirectText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          return hasDirectText && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.5;
        })
        .map((element) => {
          const style = getComputedStyle(element);
          const foreground = parseColor(style.color);
          const background = effectiveBackground(element);
          return {
            text: element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80),
            selector: element.className || element.tagName.toLowerCase(),
            color: style.color,
            background: getComputedStyle(element).backgroundColor,
            resolvedBackground: background ? [Math.round(background.r), Math.round(background.g), Math.round(background.b), Number(background.a.toFixed(2))] : null,
            ratio: foreground && background ? Number(contrast(foreground, background).toFixed(2)) : 99
          };
        })
        .filter((item) => item.ratio < 2.8)
        .slice(0, 8);
    })();
  `);

  if (failures.length) {
    throw new Error(`Contrast smoke failed for ${themeId}/${label}: ${JSON.stringify(failures)}`);
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
