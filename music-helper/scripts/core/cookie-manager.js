const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const { ensureDirectory, sleep } = require('../utils/helpers');

/**
 * @fileOverview Cookie 管理模块
 * @description 负责 Cookie 的读取、缓存、验证和自动刷新。通过 Puppeteer 自动获取新 Cookie，支持手动设置，提供 Cookie 过期检测和自动刷新功能。
 * @module cookie-manager
 */

/**
 * Cookie 缓存文件路径
 * @type {string}
 */
const COOKIE_CACHE_FILE = path.join(__dirname, '../../cache/cookie.json');

/**
 * Cookie 过期天数
 * @description Cookie 缓存的有效期，超过此天数将视为过期
 * @type {number}
 */
const COOKIE_EXPIRY_DAYS = 7;

/**
 * Cookie 即将过期警告阈值（小时）
 * @description 在此时间范围内提醒用户 Cookie 即将过期
 * @type {number}
 */
const WARNING_THRESHOLD_HOURS = 24;

/**
 * 测试 Cookie 有效性的 API URL
 * @type {string}
 */
const TEST_API_URL = 'https://flac.music.hi.cn/ajax.php?act=getUrl';

/**
 * 测试 Cookie 有效性的请求体
 * @type {string}
 */
const TEST_REQUEST_BODY = 'platform=kuwo&songid=0&time=0&sign=test';

/**
 * Chrome 调试端口
 * @description Puppeteer 连接 Chrome 时使用的调试端口
 * @type {number}
 */
const DEBUG_PORT = 9223;

/**
 * 目标网站 URL
 * @description 需要获取 Cookie 的目标网站
 * @type {string}
 */
const TARGET_URL = 'https://flac.music.hi.cn/';

/**
 * SafeLine 验证最大等待时间（毫秒）
 * @description 用户完成 SafeLine 验证的最长等待时间
 * @type {number}
 */
const MAX_WAIT_TIME = 120000;

/**
 * SafeLine 验证检查间隔（毫秒）
 * @description 检查是否完成验证的时间间隔
 * @type {number}
 */
const CHECK_INTERVAL = 3000;

/**
 * Chrome 启动等待时间（毫秒）
 * @description 启动 Chrome 后等待其完全启动的时间
 * @type {number}
 */
const CHROME_START_WAIT = 8000;

/**
 * 页面加载等待时间（毫秒）
 * @description 页面导航后等待内容加载的时间
 * @type {number}
 */
const PAGE_LOAD_WAIT = 5000;

/**
 * Cookie 缓存数据结构
 * @typedef {Object} CookieCacheData
 * @property {string} cookie - Cookie 字符串
 * @property {number} expiry - 过期时间戳（毫秒）
 * @property {string} fetchTime - 获取时间（ISO 格式字符串）
 * @property {string} source - 来源标识（'puppeteer-auto' | 'manual' | 'manual-input'）
 */

/**
 * Cookie 状态信息
 * @typedef {Object} CookieStatus
 * @property {string} cookie - Cookie 字符串
 * @property {number} expiry - 过期时间戳（毫秒）
 * @property {boolean} isValid - 是否有效
 * @property {boolean} isExpiringSoon - 是否即将过期
 * @property {string|null} fetchTime - 获取时间
 * @property {string|null} source - 来源标识
 */

/**
 * 获取 Cookie 选项
 * @typedef {Object} GetCookieOptions
 * @property {boolean} [autoRefresh=true] - 是否自动刷新
 * @property {Function} [onWarning] - 即将过期时的回调函数
 * @property {Function} [onExpired] - 已过期时的回调函数
 * @property {Function} [onRefreshing] - 正在刷新时的回调函数
 */

/**
 * 刷新进度回调状态
 * @typedef {'starting'|'launching_browser'|'connecting'|'waiting_verification'|'extracting_cookies'|'success'|'failed'} RefreshProgressStatus
 */

/**
 * 测试 Cookie 是否有效
 * @description 通过向测试 API 发送请求来验证 Cookie 是否仍然有效
 * @param {string} cookie - Cookie 字符串
 * @returns {Promise<boolean>} 是否有效
 * @example
 * const isValid = await testCookieValid('cookie_string_here');
 */
async function testCookieValid(cookie) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'flac.music.hi.cn',
      path: '/ajax.php?act=getUrl',
      method: 'POST',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'pragma': 'no-cache',
        'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-requested-with': 'XMLHttpRequest',
        'cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            if (json.code !== undefined) {
              resolve(true);
              return;
            }
          } catch (e) {}
        }
        resolve(false);
      });
    });

    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });

    req.write(TEST_REQUEST_BODY);
    req.end();
  });
}

/**
 * 获取缓存的 Cookie
 * @description 从本地缓存文件读取 Cookie，并检查其有效性和是否即将过期
 * @returns {CookieStatus|null} Cookie 状态信息，如果缓存不存在或无效则返回 null
 * @example
 * const cached = getCachedCookie();
 * if (cached && cached.isValid) {
 *   console.log('Cookie 有效');
 * }
 */
function getCachedCookie() {
  try {
    if (!fs.existsSync(COOKIE_CACHE_FILE)) {
      return null;
    }

    const content = fs.readFileSync(COOKIE_CACHE_FILE, 'utf8');
    const cookieData = JSON.parse(content);

    if (!cookieData.cookie || !cookieData.expiry) {
      return null;
    }

    const now = Date.now();
    const isValid = now < cookieData.expiry;
    const warningTime = now + (WARNING_THRESHOLD_HOURS * 60 * 60 * 1000);
    const isExpiringSoon = isValid && warningTime >= cookieData.expiry;

    return {
      cookie: cookieData.cookie,
      expiry: cookieData.expiry,
      isValid,
      isExpiringSoon,
      fetchTime: cookieData.fetchTime || null,
      source: cookieData.source || null
    };

  } catch (error) {
    console.error('[COOKIE] 读取缓存出错：', error.message);
    return null;
  }
}

/**
 * 保存 Cookie 到缓存文件
 * @description 将 Cookie 及其元数据保存到本地缓存文件，设置指定过期天数
 * @param {string} cookie - Cookie 字符串
 * @param {string} [source='manual'] - 来源标识
 * @returns {boolean} 是否保存成功
 * @example
 * const saved = saveCookieToCache('cookie_string', 'puppeteer-auto');
 */
function saveCookieToCache(cookie, source = 'manual') {
  try {
    ensureDirectory(path.dirname(COOKIE_CACHE_FILE));

    const cookieData = {
      cookie: cookie,
      expiry: Date.now() + (COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      fetchTime: new Date().toISOString(),
      source: source
    };

    fs.writeFileSync(COOKIE_CACHE_FILE, JSON.stringify(cookieData, null, 2), 'utf8');
    console.log('[COOKIE] ✅ Cookie 已保存到缓存');
    console.log(`[COOKIE] 有效期 ${COOKIE_EXPIRY_DAYS} 天`);

    return true;
  } catch (error) {
    console.error('[COOKIE] ❌ 保存 cookie 出错：', error.message);
    return false;
  }
}

/**
 * 检查 Cookie 状态并返回有效 Cookie 或触发自动刷新
 * @description 获取有效的 Cookie，如果缓存的 Cookie 无效或即将过期且启用了自动刷新，则自动刷新
 * @param {GetCookieOptions} [options={}] - 配置选项
 * @returns {Promise<string|null>} 有效的 Cookie 字符串或 null
 * @example
 * const cookie = await getValidCookie({
 *   autoRefresh: true,
 *   onWarning: (cached) => console.log('Cookie 即将过期'),
 *   onExpired: () => console.log('Cookie 已过期')
 * });
 */
async function getValidCookie(options = {}) {
  const {
    autoRefresh = true,
    onWarning = null,
    onExpired = null,
    onRefreshing = null
  } = options;

  console.log('\n[COOKIE] 正在检查认证状态...\n');

  const cached = getCachedCookie();

  if (cached && cached.isValid) {
    if (cached.isExpiringSoon) {
      console.log(`[COOKIE] ⚠️  Cookie 即将过期（${WARNING_THRESHOLD_HOURS} 小时内）`);
      if (onWarning) onWarning(cached);

      if (autoRefresh) {
        console.log('[COOKIE] 正在自动刷新 cookie...');
        return await refreshCookieAutomatically(onRefreshing);
      }
    }

    const daysLeft = Math.round((cached.expiry - Date.now()) / (1000 * 60 * 60 * 24));
    console.log(`[COOKIE] ✅ 找到 Cookie（剩余 ${daysLeft} 天）`);
    console.log('[COOKIE] 正在测试 API 访问...');

    const isApiValid = await testCookieValid(cached.cookie);

    if (isApiValid) {
      console.log('[COOKIE] ✅ API 测试通过，Cookie 有效\n');
      return cached.cookie;
    } else {
      console.log('[COOKIE] ⚠️  API 测试失败，Cookie 可能无效');
      if (onExpired) onExpired(cached);

      if (autoRefresh) {
        console.log('[COOKIE] 正在自动刷新 cookie...');
        return await refreshCookieAutomatically(onRefreshing);
      }
      return null;
    }
  } else {
    if (cached === null) {
      console.log('[COOKIE] 未找到缓存的 Cookie');
    } else {
      console.log('[COOKIE] ❌ Cookie 已过期');
      if (onExpired) onExpired(cached);
    }

    if (autoRefresh) {
      console.log('[COOKIE] 正在自动刷新 cookie...');
      return await refreshCookieAutomatically(onRefreshing);
    }

    return null;
  }
}

/**
 * 查找系统 Chrome 浏览器的可执行路径
 * @description 在常见的 Windows 安装路径中查找 Chrome 可执行文件
 * @returns {string|null} Chrome 路径，如果未找到则返回 null
 * @example
 * const chromePath = findChromePath();
 * if (chromePath) {
 *   console.log('Found Chrome at:', chromePath);
 * }
 */
function findChromePath() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  return null;
}

/**
 * 使用 Puppeteer 自动获取新 Cookie
 * @description 启动 Chrome 浏览器，导航到目标网站，提取 Cookie 并保存到缓存。支持 SafeLine 验证等待。
 * @param {Function} [onProgress] - 进度回调函数，接收 RefreshProgressStatus 类型的参数
 * @returns {Promise<string|null>} 新获取的 Cookie 字符串或 null
 * @example
 * const newCookie = await refreshCookieAutomatically((status) => {
 *   console.log('刷新进度:', status);
 * });
 */
async function refreshCookieAutomatically(onProgress = null) {
  let browser;
  let chromeProcess;

  try {
    console.log('\n[COOKIE-REFRESH] 开始自动刷新 cookie...');
    console.log('[COOKIE-REFRESH] 将打开 Chrome 浏览器窗口\n');

    if (onProgress) onProgress('starting');

    let puppeteer, StealthPlugin;
    try {
      puppeteer = require('puppeteer-extra');
      StealthPlugin = require('puppeteer-extra-plugin-stealth');
      puppeteer.use(StealthPlugin());
    } catch (error) {
      console.error('[COOKIE-REFRESH] ❌ Puppeteer 未安装！');
      console.log('[COOKIE-REFRESH] 请运行：npm install puppeteer-extra puppeteer-extra-plugin-stealth puppeteer-core');
      return null;
    }

    const chromePath = findChromePath();
    if (!chromePath) {
      throw new Error('Chrome 浏览器未找到');
    }

    const tempProfileDir = path.join(__dirname, '../../temp-chrome-cookie-refresh');

    if (fs.existsSync(tempProfileDir)) {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempProfileDir, { recursive: true });

    if (onProgress) onProgress('launching_browser');

    const chromeArgs = [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tempProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      TARGET_URL
    ];

    chromeProcess = spawn(chromePath, chromeArgs, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let launchError = null;
    chromeProcess.on('error', (err) => {
      launchError = err;
    });

    console.log('[COOKIE-REFRESH] 等待 Chrome 启动...');
    await sleep(CHROME_START_WAIT);

    if (launchError) {
      throw launchError;
    }

    if (onProgress) onProgress('connecting');

    try {
      browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
        defaultViewport: null,
        timeout: 15000
      });
    } catch (connectError) {
      throw new Error(`连接 Chrome 失败：${connectError.message}`);
    }

    console.log('[COOKIE-REFRESH] ✅ 已连接到 Chrome\n');

    if (onProgress) onProgress('waiting_verification');

    const pages = await browser.pages();
    const targetPage = pages[pages.length - 1];

    console.log('[COOKIE-REFRESH] 等待页面加载...');
    await sleep(PAGE_LOAD_WAIT);

    const pageContent = await targetPage.content();
    const isBlocked = pageContent.includes('SafeLineChallenge') ||
      pageContent.includes('sl-check') ||
      pageContent.includes('客户端异常');

    if (isBlocked) {
      console.log('\n[COOKIE-REFRESH] ⚠️  需要 SafeLine 验证');
      console.log('[COOKIE-REFRESH] 请在浏览器窗口中完成验证...');
      console.log('[COOKIE-REFRESH] 等待手动验证...\n');

      const startTime = Date.now();

      while (Date.now() - startTime < MAX_WAIT_TIME) {
        await sleep(CHECK_INTERVAL);

        const currentContent = await targetPage.content();
        if (!currentContent.includes('SafeLineChallenge')) {
          console.log('[COOKIE-REFRESH] ✅ 验证完成！\n');
          break;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        process.stdout.write(`\r[COOKIE-REFRESH] 等待中... (${elapsed}s / ${MAX_WAIT_TIME / 1000}s)`);
      }
    }

    if (onProgress) onProgress('extracting_cookies');

    console.log('[COOKIE-REFRESH] 正在提取 cookies...');
    const cookies = await targetPage.cookies(TARGET_URL);

    if (cookies && cookies.length > 0) {
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      saveCookieToCache(cookieString, 'puppeteer-auto-refresh');

      console.log(`[COOKIE-REFRESH] ✅ 成功获取 ${cookies.length} 个 cookie\n`);

      try {
        await browser.disconnect();
      } catch (e) {}

      if (chromeProcess && !chromeProcess.killed) {
        chromeProcess.kill();
      }

      try {
        fs.rmSync(tempProfileDir, { recursive: true, force: true });
      } catch (e) {}

      if (onProgress) onProgress('success');

      return cookieString;

    } else {
      throw new Error('未从页面获取到 cookies');
    }

  } catch (error) {
    console.error(`\n[COOKIE-REFRESH] ❌ 失败：${error.message}\n`);

    try {
      if (browser) await browser.disconnect();
    } catch (e) {}
    try {
      if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();
    } catch (e) {}

    if (onProgress) onProgress('failed');

    return null;
  }
}

/**
 * 手动设置 Cookie
 * @description 将用户手动提供的 Cookie 保存到缓存，通常用于用户从浏览器开发者工具复制的 Cookie
 * @param {string} cookie - 用户提供的 Cookie 字符串
 * @returns {boolean} 是否保存成功
 * @example
 * const success = setManualCookie('name=value; name2=value2');
 */
function setManualCookie(cookie) {
  if (cookie && cookie.trim()) {
    return saveCookieToCache(cookie.trim(), 'manual-input');
  }
  return false;
}

module.exports = {
  /**
   * 获取缓存的 Cookie
   * @see {@link getCachedCookie}
   */
  getCachedCookie,

  /**
   * 检查 Cookie 状态并返回有效 Cookie 或触发自动刷新
   * @see {@link getValidCookie}
   */
  getValidCookie,

  /**
   * 保存 Cookie 到缓存文件
   * @see {@link saveCookieToCache}
   */
  saveCookieToCache,

  /**
   * 手动设置 Cookie
   * @see {@link setManualCookie}
   */
  setManualCookie,

  /**
   * 使用 Puppeteer 自动获取新 Cookie
   * @see {@link refreshCookieAutomatically}
   */
  refreshCookieAutomatically,

  /**
   * 查找系统 Chrome 浏览器的可执行路径
   * @see {@link findChromePath}
   */
  findChromePath,

  /**
   * Cookie 缓存文件路径
   */
  COOKIE_CACHE_FILE,

  /**
   * Cookie 过期天数
   */
  COOKIE_EXPIRY_DAYS,

  /**
   * 警告阈值（小时）
   */
  WARNING_THRESHOLD_HOURS
};
