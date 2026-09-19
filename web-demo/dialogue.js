// English transcribed from the user-provided episode 5 screenshot.
// Chinese translations are editorial; video identity and timings are unverified.
export const dialogue = [
  ['欧文', 'Ollie!', '奥利！'],
  ['奥利', 'Owen!', '欧文！'],
  ['奥利', 'This is our neighbor, Owen.', '这是我们的邻居，欧文。'],
  ['奥利', 'And this is my new roommate, Danny.', '这位是我的新室友，丹尼。'],
  ['欧文', 'Hi! Nice to meet you.', '嗨！很高兴认识你。'],
  ['丹尼', 'Nice to meet you too.', '我也很高兴认识你。'],
  ['欧文', 'Where are you guys going?', '你们要去哪儿？'],
  ['奥利', 'We’re going to the supermarket.', '我们要去超市。'],
  ['丹尼', 'Ollie wants some sausages.', '奥利想买些香肠。'],
  ['欧文', 'Get in! Let me give you guys a ride.', '上车吧！我载你们一程。'],
  ['奥利', 'Sure!', '好啊！'],
  ['欧文', 'Come over to my place on Saturday. I’m going to have a barbecue.', '周六来我家吧。我打算办个烧烤聚会。'],
  ['奥利', 'Sounds great!', '听起来很棒！'],
  ['奥利', 'You can drop us off here.', '你在这里让我们下车就行。'],
  ['欧文', 'Sure!', '没问题！'],
  ['欧文', 'Bye, Ollie! Bye, Danny!', '再见，奥利！再见，丹尼！'],
  ['奥利 & 丹尼', 'Bye, Owen!', '再见，欧文！'],
];

export const video = { bvid: 'BV1KCeA6gEya', aid: '117281212338526', cid: '41951169920', p: '1' };
export function parseTime(value) {
  const text = value.trim();
  if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(text) && !/^\d{1,3}:[0-5]\d(?:\.\d{1,3})?$/.test(text)) return null;
  const parts = text.split(':').map(Number);
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return seconds <= 86400 ? seconds : null;
}
export function playerUrl(seconds = 0, autoplay = false) {
  const url = new URL('https://player.bilibili.com/player.html');
  const params = { ...video, isOutside: 'true', danmaku: '0', autoplay: autoplay ? '1' : '0', t: String(seconds) };
  url.search = new URLSearchParams(params).toString();
  return url.href;
}
