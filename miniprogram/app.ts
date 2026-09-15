import { initTheme } from './utils/theme';

App({
  onLaunch() {
    initTheme();
    wx.setInnerAudioOption({ obeyMuteSwitch: false });
  },
});
