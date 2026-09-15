export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'themeMode';
const modes: ThemeMode[] = ['system', 'light', 'dark'];

type ThemePage = {
  setData(data: { theme: ResolvedTheme; themeMode: ThemeMode }): void;
};

export function getThemeMode(): ThemeMode {
  const value = wx.getStorageSync(STORAGE_KEY);
  return modes.includes(value as ThemeMode) ? value as ThemeMode : 'system';
}

function systemTheme(): ResolvedTheme {
  return wx.getAppBaseInfo().theme === 'dark' ? 'dark' : 'light';
}

export function themeState(mode = getThemeMode(), system = systemTheme()) {
  return { themeMode: mode, theme: mode === 'system' ? system : mode };
}

function applyChrome(theme: ResolvedTheme) {
  const dark = theme === 'dark';
  wx.setNavigationBarColor({ frontColor: dark ? '#ffffff' : '#000000', backgroundColor: dark ? '#101612' : '#f5f4ee' });
  wx.setBackgroundColor({
    backgroundColor: dark ? '#101612' : '#f5f4ee',
    backgroundColorTop: dark ? '#101612' : '#f5f4ee',
    backgroundColorBottom: dark ? '#101612' : '#f5f4ee',
  });
  wx.setTabBarStyle({
    color: dark ? '#9aa69c' : '#777d73',
    selectedColor: dark ? '#91c3a1' : '#245b43',
    backgroundColor: dark ? '#18211b' : '#ffffff',
    borderStyle: dark ? 'black' : 'white',
  });
}

function updatePages(state: ReturnType<typeof themeState>) {
  getCurrentPages().forEach(page => (page as unknown as ThemePage).setData(state));
}

export function syncTheme(page: ThemePage) {
  const state = themeState();
  page.setData(state);
  applyChrome(state.theme);
}

export function setThemeMode(mode: ThemeMode) {
  if (!modes.includes(mode)) return;
  wx.setStorageSync(STORAGE_KEY, mode);
  const state = themeState(mode);
  updatePages(state);
  applyChrome(state.theme);
}

let listening = false;
export function initTheme() {
  const state = themeState();
  applyChrome(state.theme);
  if (listening) return;
  listening = true;
  wx.onThemeChange(({ theme }) => {
    if (getThemeMode() !== 'system') return;
    const state = themeState('system', theme === 'dark' ? 'dark' : 'light');
    updatePages(state);
    applyChrome(state.theme);
  });
}
