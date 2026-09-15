import { subscribeTheme,themeState } from '../utils/theme';

const tabs = [
  { pagePath: '/pages/index/index', text: '学习', mark: '句' },
  { pagePath: '/pages/me/me', text: '我的', mark: '我' },
];
const unsubscribers = new WeakMap<object, () => void>();

Component({
  data: { ...themeState(), selected: 0, tabs },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const route = `/${pages[pages.length - 1]?.route || 'pages/index/index'}`;
      this.setData({ ...themeState(), selected: Math.max(0, tabs.findIndex(item => item.pagePath === route)) });
      unsubscribers.set(this, subscribeTheme(state => this.setData(state)));
    },
    detached() { unsubscribers.get(this)?.();unsubscribers.delete(this); },
  },
  methods: {
    switchTab(event: WechatMiniprogram.BaseEvent) {
      const index = Number(event.currentTarget.dataset.index);
      const item = tabs[index];
      if (!item || index === this.data.selected) return;
      this.setData({ selected: index });
      wx.switchTab({ url: item.pagePath });
    },
  },
});
