import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function themeModule(systemTheme: 'light' | 'dark', stored: unknown = 'system') {
  let value = stored;
  let listener: ((event: { theme: 'light' | 'dark' }) => void) | undefined;
  const pages = [{ data: {} as Record<string, unknown>, setData(data: Record<string, unknown>) { Object.assign(this.data, data); } }];
  const navigation: Record<string, unknown>[] = [], tabs: Record<string, unknown>[] = [], backgrounds: Record<string, unknown>[] = [];
  const wx = {
    getStorageSync: () => value,
    setStorageSync: (_key: string, next: unknown) => { value = next; },
    getAppBaseInfo: () => ({ theme: systemTheme }),
    setNavigationBarColor: (options: Record<string, unknown>) => navigation.push(options),
    setTabBarStyle: (options: Record<string, unknown>) => tabs.push(options),
    setBackgroundColor: (options: Record<string, unknown>) => backgrounds.push(options),
    onThemeChange: (callback: typeof listener) => { listener = callback; },
  };
  const source = readFileSync(resolve(__dirname, '../../miniprogram/utils/theme.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (...args: any[]) => any> = {};
  vm.runInNewContext(compiled, { exports, wx, getCurrentPages: () => pages });
  return { exports, pages, navigation, tabs, backgrounds, fire: (theme: 'light' | 'dark') => listener?.({ theme }), stored: () => value };
}

test('theme follows system changes and updates page, navigation and tab bar together', () => {
  const fixture = themeModule('dark');
  assert.equal(fixture.exports.themeState().theme, 'dark');
  fixture.exports.initTheme();
  assert.equal(fixture.navigation.at(-1)?.frontColor, '#ffffff');
  assert.equal(fixture.tabs.at(-1)?.backgroundColor, '#18211b');
  fixture.fire('light');
  assert.equal(fixture.pages[0].data.theme, 'light');
  assert.equal(fixture.backgrounds.at(-1)?.backgroundColor, '#f5f4ee');
});

test('manual theme persists and ignores later system changes', () => {
  const fixture = themeModule('dark');
  fixture.exports.initTheme();
  fixture.exports.setThemeMode('light');
  assert.equal(fixture.stored(), 'light');
  assert.equal(fixture.pages[0].data.theme, 'light');
  const updates = fixture.navigation.length;
  fixture.fire('dark');
  assert.equal(fixture.navigation.length, updates);
  assert.equal(fixture.pages[0].data.theme, 'light');
});

test('manual and system changes notify custom theme components without page lifecycle recursion', () => {
  const fixture = themeModule('dark');
  const themes: string[] = [];
  const unsubscribe = fixture.exports.subscribeTheme((state: { theme: string }) => themes.push(state.theme));
  fixture.exports.setThemeMode('light');
  fixture.exports.setThemeMode('system');
  fixture.exports.initTheme();
  fixture.fire('dark');
  unsubscribe();
  fixture.exports.setThemeMode('light');
  assert.deepEqual(themes, ['light', 'dark', 'dark']);
});

test('unknown saved theme safely falls back to system', () => {
  const fixture = themeModule('dark', 'unexpected');
  assert.equal(fixture.exports.getThemeMode(), 'system');
  assert.equal(fixture.exports.themeState().theme, 'dark');
});

test('all pages opt into theme classes and fixed colors use shared variables', () => {
  for (const page of ['index', 'collection', 'episode', 'me', 'profile', 'review']) {
    const wxml = readFileSync(resolve(__dirname, `../../miniprogram/pages/${page}/${page}.wxml`), 'utf8');
    assert.match(wxml, /class="[^"]*page[^"]*theme-\{\{theme\}\}"/);
  }
  const styles = readFileSync(resolve(__dirname, '../../miniprogram/app.wxss'), 'utf8');
  assert.match(styles, /\.theme-dark/);
  assert.match(styles, /--surface: #18211b/);
});

test('learning route pages keep page backgrounds in sync with manual dark mode', () => {
  for (const page of ['index', 'collection', 'episode']) {
    const wxml = readFileSync(resolve(__dirname, `../../miniprogram/pages/${page}/${page}.wxml`), 'utf8');
    assert.match(wxml, /root-background-color="\{\{theme === 'dark'/);
    assert.match(wxml, /<page-meta[^>]+background-color-top="\{\{theme === 'dark'/);
    assert.match(wxml, /background-color-bottom="\{\{theme === 'dark'/);
    assert.match(wxml, /<app-nav[^>]+theme="\{\{theme\}\}"/);
  }
});

test('custom navigation and tab bar replace native chrome during route transitions', () => {
  const app = JSON.parse(readFileSync(resolve(__dirname, '../../miniprogram/app.json'), 'utf8'));
  assert.equal(app.window.navigationStyle, 'custom');
  assert.equal(app.tabBar.custom, true);
  const tabBar = readFileSync(resolve(__dirname, '../../miniprogram/custom-tab-bar/index.wxml'), 'utf8');
  const navigation = readFileSync(resolve(__dirname, '../../miniprogram/components/app-nav/index.wxml'), 'utf8');
  assert.match(tabBar, /tab-bar-\{\{theme\}\}/);
  assert.match(navigation, /nav-\{\{theme\}\}/);
});
