const windowInfo = wx.getWindowInfo();
const menuButton = wx.getMenuButtonBoundingClientRect();
const statusBarHeight = windowInfo.statusBarHeight || 0;
const navigationHeight = Math.max(44, (menuButton.top - statusBarHeight) * 2 + menuButton.height);

Component({
  data: { statusBarHeight, navigationHeight },
  properties: {
    title: { type: String, value: '拾句英语' },
    back: { type: Boolean, value: false },
    theme: { type: String, value: 'light' },
  },
  methods: {
    goBack() {
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.switchTab({ url: '/pages/index/index' });
    },
  },
});
