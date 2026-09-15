export type AppEnv = 'dev' | 'prod';

// 修改此参数后，在微信开发者工具中重新编译。
export const APP_ENV: AppEnv = 'prod';

const API_BASE_URLS: Record<AppEnv, string> = {
  // 真机调试需要手机与电脑连接同一网络；电脑 IP 变化时更新这里。
  dev: 'http://192.168.1.5:3000/api',
  prod: 'https://eng.yutc.top/api',
};

export const API_BASE_URL = API_BASE_URLS[APP_ENV];
