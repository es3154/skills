/**
 * Music Helper API 模块
 * 提供非交互式的编程接口，供 Skill 调用
 */

const path = require('path');
const { getValidCookie, setManualCookie } = require('./cookie-manager');
const { searchMusic, formatResultsTable, getSongsFromCacheByIndices } = require('./search');
const { batchDownload } = require('./download');
const { addToCart, getCart, removeFromCart, clearCart, formatCartTable } = require('./cart');

class MusicHelperAPI {
  constructor(options = {}) {
    this.options = {
      autoRefreshCookie: true,
      downloadLyric: true,
      ...options
    };

    this._cookie = null;
  }

  async getCookie() {
    if (!this._cookie) {
      this._cookie = await getValidCookie({
        autoRefresh: this.options.autoRefreshCookie,
        onWarning: (cached) => console.log(`[API] Cookie 即将过期`),
        onExpired: () => console.log(`[API] Cookie 已过期，正在刷新...`),
        onRefreshing: (status) => {
          if (status === 'starting') console.log(`[API] 开始刷新 Cookie...`);
          else if (status === 'success') console.log(`[API] Cookie 刷新成功`);
          else if (status === 'failed') console.log(`[API] Cookie 刷新失败`);
        }
      });

      if (!this._cookie) {
        throw new Error('获取有效 Cookie 失败');
      }
    }

    return this._cookie;
  }

  async setCookie(cookie) {
    this._cookie = null;
    return setManualCookie(cookie);
  }

  async refreshCookie() {
    this._cookie = null;
    this._cookie = await getValidCookie({
      autoRefresh: true,
      onWarning: (cached) => console.log(`[API] Cookie 即将过期`),
      onExpired: () => console.log(`[API] Cookie 已过期，正在刷新...`),
      onRefreshing: (status) => {
        if (status === 'starting') console.log(`[API] 开始刷新 Cookie...`);
        else if (status === 'success') console.log(`[API] Cookie 刷新成功`);
        else if (status === 'failed') console.log(`[API] Cookie 刷新失败`);
      }
    });

    if (!this._cookie) {
      throw new Error('刷新 Cookie 失败');
    }
    return this._cookie;
  }

  async search(keyword, options = {}) {
    try {
      const cookie = await this.getCookie();

      console.log(`\n[API] 🔍 正在搜索："${keyword}"${options.page ? `（第 ${options.page} 页）` : ''}\n`);

      const searchResult = await searchMusic(cookie, keyword, options);

      if (!searchResult.success) {
        return {
          success: false,
          total: 0,
          results: [],
          error: searchResult.message || '搜索失败'
        };
      }

      return {
        success: true,
        total: searchResult.total,
        results: searchResult.results,
        page: searchResult.page,
        hasMore: searchResult.hasMore,
        formattedTable: formatResultsTable(searchResult.results),
        raw: searchResult.results
      };

    } catch (error) {
      console.error(`[API] ❌ 搜索错误：${error.message}`);
      return {
        success: false,
        total: 0,
        results: [],
        error: error.message
      };
    }
  }

  async searchNextPage(keyword) {
    const cache = getSearchCache(keyword);
    if (!cache) {
      return { success: false, error: '缓存中未找到之前的搜索', results: [] };
    }

    const nextPage = (cache.page || 1) + 1;
    const totalPages = Math.ceil(cache.total / 30);

    if (nextPage > totalPages) {
      return { success: false, error: '已经是最后一页', hasMore: false, results: [] };
    }

    return this.search(keyword, { page: nextPage });
  }

  async download(selections, options = {}) {
    try {
      const cookie = await this.getCookie();
      const downloadDir = options.downloadDir || this.options.downloadDir;

      let selectedSongs;

      if (typeof selections[0] === 'number') {
        selectedSongs = getSongsFromCacheByIndices(selections);
      } else if (typeof selections[0] === 'object') {
        selectedSongs = selections.map((song, i) => ({
          ...song,
          selectedIndex: i + 1
        }));
      } else {
        throw new Error('无效的选择格式。请使用序号数组或结果对象数组。');
      }

      if (selectedSongs.length === 0) {
        return {
          success: false,
          downloaded: 0,
          failed: 0,
          errors: ['未选择有效歌曲或缓存为空'],
          files: []
        };
      }

      console.log(`\n[API] ⬇️  准备下载 ${selectedSongs.length} 首歌曲...\n`);

      const downloadResult = await batchDownload(cookie, selectedSongs, {
        downloadLyric: options.downloadLyric !== undefined ? options.downloadLyric : this.options.downloadLyric,
        stopOnError: false,
        downloadDir,
        onProgress: (current, total, title, artist) => {
          console.log(`[API] [${current}/${total}] 正在处理：${title} - ${artist}`);
        },
        onItemComplete: (current, total, result, musicInfo) => {}
      });

      return {
        success: downloadResult.summary.success > 0,
        summary: downloadResult.summary,
        downloaded: downloadResult.summary.success,
        failed: downloadResult.summary.failed,
        files: downloadResult.results
          .filter(r => r.success)
          .flatMap(r => r.files),
        errors: downloadResult.results
          .filter(r => !r.success)
          .flatMap(r => r.errors),
        duration: downloadResult.summary.durationFormatted
      };

    } catch (error) {
      console.error(`[API] ❌ 下载错误：${error.message}`);
      return {
        success: false,
        downloaded: 0,
        failed: Array.isArray(selections) ? selections.length : 0,
        errors: [error.message],
        files: []
      };
    }
  }

  async searchAndDownload(keyword, indices) {
    const searchResult = await this.search(keyword);
    if (!searchResult.success) {
      return { searchResult, downloadResult: null };
    }

    const downloadResult = await this.download(indices);
    return { searchResult, downloadResult };
  }

  addToCart(indices) {
    const songs = getSongsFromCacheByIndices(indices);
    if (songs.length === 0) {
      return { success: false, added: 0, total: 0, error: '缓存中未找到有效歌曲' };
    }
    return addToCart(songs);
  }

  getCart() {
    return getCart();
  }

  getCartTable() {
    const cart = getCart();
    return formatCartTable(cart);
  }

  removeFromCart(indices) {
    return removeFromCart(indices);
  }

  clearCart() {
    clearCart();
    return { success: true };
  }

  async downloadFromCart(options = {}) {
    const cart = getCart();
    if (cart.length === 0) {
      return {
        success: false,
        downloaded: 0,
        failed: 0,
        errors: ['购物车为空'],
        files: []
      };
    }

    const downloadDir = options.downloadDir || this.options.downloadDir;
    const downloadResult = await this.download(cart.map(s => ({ ...s, selectedIndex: s.cartIndex })), { downloadDir });

    if (downloadResult.success && downloadResult.failed === 0) {
      clearCart();
    }

    return downloadResult;
  }
}

function createAPI(options) {
  return new MusicHelperAPI(options);
}

module.exports = { createAPI, MusicHelperAPI };