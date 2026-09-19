import { subscribeTheme,themeState } from '../utils/theme';

const tabs = [
  { pagePath: '/pages/index/index', text: '学习' },
  { pagePath: '/pages/me/me', text: '我的' },
];
const unsubscribers = new WeakMap<object, () => void>();
const currentRoute = () => {
  const pages = getCurrentPages();
  return `/${pages[pages.length - 1]?.route || 'pages/index/index'}`;
};

Component({
  data: { ...themeState(), selected: 0, tabs },
  lifetimes: {
    attached() {
      this.setData(themeState());
      this.syncSelected();
      unsubscribers.set(this, subscribeTheme(state => this.setData(state)));
    },
    detached() { unsubscribers.get(this)?.();unsubscribers.delete(this); },
  },
  pageLifetimes: {
    show() { this.syncSelected(); },
  },
  methods: {
    syncSelected() {
      const selected = Math.max(0, tabs.findIndex(item => item.pagePath === currentRoute()));
      if (selected !== this.data.selected) this.setData({ selected });
    },
    switchTab(event: WechatMiniprogram.BaseEvent) {
      const index = Number(event.currentTarget.dataset.index);
      const item = tabs[index];
      if (!item || item.pagePath === currentRoute()) return;
      wx.switchTab({ url: item.pagePath });
    },
  },
});
