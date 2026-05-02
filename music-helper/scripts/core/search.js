const fs = require('fs');
const path = require('path');
const { sendPostRequest, sleep } = require('../utils/helpers');

/**
 * 音乐检索模块
 * 负责调用检索接口并返回格式化的结果
 */

// 检索接口配置
const SEARCH_API_URL = 'https://flac.music.hi.cn/ajax.php?act=search';
const DEFAULT_PAGE_SIZE = 10;

// 缓存配置
const CACHE_DIR = path.join(__dirname, '../../cache');
const SEARCH_CACHE_FILE = path.join(CACHE_DIR, 'search_cache.json');
const CACHE_EXPIRY = 30 * 60 * 1000; // 30分钟缓存有效期

/**
 * 保存搜索结果到缓存
 * @param {string} keyword - 搜索关键词
 * @param {Array} results - 搜索结果数组
 * @param {number} total - 总结果数
 * @param {number} page - 当前页码
 */
function saveSearchCache(keyword, results, total, page = 1) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cacheData = {
      keyword: keyword.toLowerCase(),
      results: results,
      total: total,
      page: page,
      timestamp: Date.now()
    };

    fs.writeFileSync(SEARCH_CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
    console.log(`[CACHE] 搜索结果已保存：${results.length} 条（第 ${page} 页）`);
  } catch (error) {
    console.error(`[CACHE] 保存搜索缓存失败：${error.message}`);
  }
}

/**
 * 从缓存获取搜索结果
 * @param {string} keyword - 搜索关键词
 * @returns {Object|null} - 缓存的搜索结果或null
 */
function getSearchCache(keyword) {
  try {
    if (!fs.existsSync(SEARCH_CACHE_FILE)) {
      return null;
    }

    const content = fs.readFileSync(SEARCH_CACHE_FILE, 'utf8');
    const cacheData = JSON.parse(content);

    if (cacheData.keyword !== keyword.toLowerCase()) {
      return null;
    }

    if (Date.now() - cacheData.timestamp > CACHE_EXPIRY) {
      console.log(`[CACHE] 搜索缓存已过期`);
      return null;
    }

    console.log(`[CACHE] 已从缓存加载搜索结果：${cacheData.results.length} 条`);
    return cacheData;
  } catch (error) {
    console.error(`[CACHE] 加载搜索缓存失败：${error.message}`);
    return null;
  }
}

/**
 * 根据序号从缓存获取歌曲信息
 * @param {number} index - 序号（从1开始）
 * @returns {Object|null} - 歌曲信息或null
 */
function getSongFromCacheByIndex(index) {
  try {
    if (!fs.existsSync(SEARCH_CACHE_FILE)) {
      return null;
    }

    const content = fs.readFileSync(SEARCH_CACHE_FILE, 'utf8');
    const cacheData = JSON.parse(content);

    const idx = index - 1; // 转为0-based index
    if (idx < 0 || idx >= cacheData.results.length) {
      console.error(`[CACHE] 序号 ${index} 超出范围（1-${cacheData.results.length}）`);
      return null;
    }

    return cacheData.results[idx];
  } catch (error) {
    console.error(`[CACHE] 从缓存获取歌曲失败：${error.message}`);
    return null;
  }
}

/**
 * 根据序号数组从缓存获取歌曲信息
 * @param {Array<number>} indices - 序号数组（从1开始）
 * @returns {Array<Object>} - 歌曲信息数组
 */
function getSongsFromCacheByIndices(indices) {
  const songs = [];
  for (const index of indices) {
    const song = getSongFromCacheByIndex(index);
    if (song) {
      songs.push({ ...song, selectedIndex: songs.length + 1 });
    }
  }
  return songs;
}

/**
 * 构建标准请求头（包含 Cookie）
 * @param {string} cookie - 认证 Cookie
 * @returns {Object} - 请求头对象
 */
function buildRequestHeaders(cookie) {
  return {
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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'Referer': 'https://flac.music.hi.cn/'
  };
}

/**
 * 搜索音乐
 * @param {string} cookie - 认证 Cookie
 * @param {string} keyword - 搜索关键词（可以是歌曲名、歌手名或两者组合）
 * @param {Object} [options] - 可选参数
 * @param {number} [options.page=1] - 页码
 * @param {number} [options.size=30] - 每页数量
 * @returns {Promise<{success: boolean, results: Array, total: number, message: string}>}
 */
async function searchMusic(cookie, keyword, options = {}) {
  const { page = 1, size = DEFAULT_PAGE_SIZE } = options;
  
  console.log(`\n🔍 正在搜索："${keyword}"`);
  console.log(`   页码：${page}，每页：${size}\n`);
  
  try {
    // 构建请求选项
    const requestOptions = {
      method: 'POST',
      headers: buildRequestHeaders(cookie)
    };
    
    // 构建请求体
    const requestBody = `platform=kuwo&keyword=${encodeURIComponent(keyword)}&page=${page}&size=${size}`;
    
    console.log('[SEARCH] 正在发送 API 请求...');
    
    // 发送请求
    const response = await sendPostRequest(SEARCH_API_URL, requestOptions, requestBody);
    
    if (!response || response.code !== 0) {
      return {
        success: false,
        results: [],
        total: 0,
        message: response?.msg || 'API 返回错误'
      };
    }
    
    if (!response.data || !response.data.list || response.data.list.length === 0) {
      return {
        success: true,
        results: [],
        total: 0,
        message: '未找到结果'
      };
    }
    
    // 解析并过滤有效结果
    const parsedResults = parseSearchResults(response.data.list, keyword);

    console.log(`[SEARCH] ✅ 找到 ${parsedResults.length} 条结果\n`);

    // 保存到缓存
    saveSearchCache(keyword, parsedResults, response.data.total || parsedResults.length, page);

    return {
      success: true,
      results: parsedResults,
      total: response.data.total || parsedResults.length,
      page: page,
      hasMore: parsedResults.length === size,
      message: `找到 ${parsedResults.length} 条结果`
    };
    
  } catch (error) {
    console.error(`[SEARCH] ❌ 错误：${error.message}`);

    let userMessage = '搜索失败';
    if (error.message.includes('HTML_RESPONSE') || error.message.includes('Cookie')) {
      userMessage = '认证失败（Cookie 可能无效）';
    } else if (error.message.includes('TIMEOUT') || error.message.includes('network')) {
      userMessage = '网络超时或连接错误';
    } else if (error.message.includes('HTTP 4') || error.message.includes('HTTP 5')) {
      userMessage = '服务器错误（HTTP 状态码）';
    }

    return {
      success: false,
      results: [],
      total: 0,
      message: userMessage
    };
  }
}

/**
 * 解析原始 API 响应为标准化格式
 * @param {Array} rawList - API 返回的原始列表
 * @param {string} keyword - 搜索关键词（用于相关性排序）
 * @returns {Array} - 标准化后的结果数组
 */
function parseSearchResults(rawList, keyword) {
  const results = [];
  
  for (const item of rawList) {
    if (!item.minfo) continue;
    
    // 提取所有可用的音质版本
    const availableFormats = [];
    
    for (const info of item.minfo) {
      if (info.format === 'flac' || info.format === 'mp3') {
        availableFormats.push({
          format: info.format.toUpperCase(),
          size: info.size || 0,
          bitrate: info.bitrate || 0,
          level: info.level || '',
          quality: getQualityDescription(info.format, info.level, info.bitrate)
        });
      }
    }
    
    if (availableFormats.length === 0) continue;
    
    // 选择最佳音质（FLAC 优先，然后按比特率排序）
    availableFormats.sort((a, b) => {
      if (a.format !== b.format) {
        return a.format === 'FLAC' ? -1 : 1;
      }
      return parseInt(b.bitrate) - parseInt(a.bitrate);
    });
    
    const bestFormat = availableFormats[0];
    
    results.push({
      id: item.id,
      title: item.name,
      artist: item.artist,
      album: item.album_name || '未知专辑',
      format: bestFormat.format,
      size: bestFormat.size,
      bitrate: bestFormat.bitrate,
      quality: bestFormat.quality,
      picUrl: item.pic_url || null,
      duration: item.time ? formatDuration(item.time) : '未知',
      time: item.time || Math.floor(Date.now() / 1000),
      sign: item.sign || '',
      allFormats: availableFormats
    });
  }
  
  // 按关键词匹配度简单排序（可选）
  if (keyword && results.length > 1) {
    results.sort((a, b) => {
      const scoreA = calculateRelevanceScore(a, keyword);
      const scoreB = calculateRelevanceScore(b, keyword);
      return scoreB - scoreA;
    });
  }
  
  return results;
}

/**
 * 获取音质描述文本
 * @param {string} format - 格式（flac/mp3）
 * @param {string} level - 等级（ff 等）
 * @param {number} bitrate - 比特率
 * @returns {string} - 音质描述
 */
function getQualityDescription(format, level, bitrate) {
  if (format === 'flac') {
    if (level === 'ff') return '无损品质';
    return '高品质';
  }
  
  return `${bitrate}kbps`;
}

/**
 * 格式化时长
 * @param {number} seconds - 秒数
 * @returns {string} - 格式化后的时长（如 "4:32"）
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '未知';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 计算搜索结果与关键词的相关性分数
 * @param {Object} result - 搜索结果项
 * @param {string} keyword - 关键词
 * @returns {number} - 相关性分数（越高越相关）
 */
function calculateRelevanceScore(result, keyword) {
  const lowerKeyword = keyword.toLowerCase();
  const lowerTitle = (result.title || '').toLowerCase();
  const lowerArtist = (result.artist || '').toLowerCase();
  
  let score = 0;
  
  // 标题完全匹配
  if (lowerTitle === lowerKeyword) score += 100;
  else if (lowerTitle.includes(lowerKeyword)) score += 50;
  
  // 歌手匹配
  if (lowerArtist === lowerKeyword) score += 80;
  else if (lowerArtist.includes(lowerKeyword)) score += 40;
  
  // 标题 + 歌手组合匹配
  if (`${lowerTitle} ${lowerArtist}`.includes(lowerKeyword)) score += 60;
  
  return score;
}

/**
 * 格式化搜索结果为用户友好的表格
 * @param {Array} results - 搜索结果数组
 * @returns {string} - 格式化后的表格字符串
 */
function formatResultsTable(results) {
  if (!results || results.length === 0) {
    return '\n❌ 未找到结果\n';
  }
  
  const lines = [];
  lines.push('\n' + '='.repeat(90));
  lines.push('🎵 搜索结果'.padEnd(45) + '📊');
  lines.push('='.repeat(90));
  lines.push('');
  lines.push(
    '  #'.padEnd(6) +
    '| 歌名'.padEnd(28) +
    '| 歌手'.padEnd(20) +
    '| 专辑'.padEnd(18) +
    '| 格式'.padEnd(8) +
    '| 大小'
  );
  lines.push('-'.repeat(90));
  
  results.forEach((result, index) => {
    const num = (index + 1).toString().padEnd(6);
    const title = truncateString(result.title, 26).padEnd(28);
    const artist = truncateString(result.artist, 18).padEnd(20);
    const album = truncateString(result.album, 16).padEnd(18);
    const format = result.format.padEnd(8);
    const size = formatFileSize(result.size);
    
    lines.push(`${num}|${title}|${artist}|${album}|${format}|${size}`);
  });
  
  lines.push('='.repeat(90));
  lines.push(`总计：${results.length} 条结果\n`);
  
  return lines.join('\n');
}

/**
 * 截断字符串到指定长度
 * @param {string} str - 原始字符串
 * @param {number} maxLength - 最大长度
 * @returns {string} - 截断后的字符串
 */
function truncateString(str, maxLength) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * 格式化文件大小
 * @param {number|string} size - 大小（字节或带单位字符串）
 * @returns {string} - 格式化后的大小
 */
function formatFileSize(size) {
  if (!size) return '未知';
  
  if (typeof size === 'string') {
    return size; // 已经是格式化的字符串
  }
  
  const bytes = parseInt(size);
  if (isNaN(bytes) || bytes === 0) return '未知';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const formattedSize = (bytes / Math.pow(k, i)).toFixed(1);
  
  return `${formattedSize} ${units[i]}`;
}

module.exports = {
  searchMusic,
  formatResultsTable,
  parseSearchResults,
  saveSearchCache,
  getSearchCache,
  getSongFromCacheByIndex,
  getSongsFromCacheByIndices
};
