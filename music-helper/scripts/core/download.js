const fs = require('fs');
const path = require('path');
const { sendPostRequest, downloadFile, ensureDirectory, sanitizeFilename, formatFileSize, sleep } = require('../utils/helpers');

/**
 * 下载管理模块
 * 负责获取下载地址、歌词，并执行实际的文件下载操作
 */

// API 配置
const DOWNLOAD_URL_API = 'https://flac.music.hi.cn/ajax.php?act=getUrl';
const LYRIC_API = 'https://flac.music.hi.cn/ajax.php?act=getLyric';
const SEARCH_API_URL = 'https://flac.music.hi.cn/ajax.php?act=search';

function buildHeaders(cookie) {
  return {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
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

async function getDownloadUrl(cookie, musicInfo, retryCount = 3) {
  const { id, title, artist, sign, time } = musicInfo;

  console.log(`[URL] 正在获取下载地址：${title} - ${artist}`);

  try {
    const options = {
      method: 'POST',
      headers: buildHeaders(cookie)
    };

    const requestBody = `platform=kuwo&songid=${id}&format=flac&bitrate=2000&time=${time || Math.floor(Date.now() / 1000)}&sign=${sign}`;

    const response = await sendPostRequest(DOWNLOAD_URL_API, options, requestBody, retryCount);

    if (!response || response.code !== 0 || !response.data) {
      return {
        success: false,
        url: null,
        format: musicInfo.format,
        size: 0,
        message: response?.msg || '获取下载地址失败'
      };
    }

    const downloadUrl = response.data.url;

    if (!downloadUrl) {
      return {
        success: false,
        url: null,
        format: musicInfo.format,
        size: 0,
        message: '响应中无下载地址'
      };
    }

    console.log(`[URL] ✅ 获取到下载地址`);

    return {
      success: true,
      url: downloadUrl,
      format: musicInfo.format,
      size: response.data.size || musicInfo.size || 0,
      message: '成功'
    };

  } catch (error) {
    console.error(`[URL] ❌ 错误：${error.message}`);

    let userMessage = '获取下载地址失败';
    if (error.message.includes('HTML_RESPONSE') || error.message.includes('Cookie')) {
      userMessage = 'Cookie 无效或已过期';
    }

    return {
      success: false,
      url: null,
      format: musicInfo.format,
      size: 0,
      message: userMessage
    };
  }
}

async function getLyric(cookie, musicInfo) {
  const { id, title, artist, sign, time } = musicInfo;

  console.log(`[LYRIC] 正在获取歌词：${title} - ${artist}`);

  try {
    const options = {
      method: 'POST',
      headers: buildHeaders(cookie)
    };

    const requestBody = `platform=kuwo&songid=${id}&time=${time || Math.floor(Date.now() / 1000)}&sign=${sign}`;

    const response = await sendPostRequest(LYRIC_API, options, requestBody);

    if (response.code === 0 && response.data) {
      console.log(`[LYRIC] ✅ 获取到歌词`);
      return {
        success: true,
        lyric: response.data,
        message: '成功'
      };
    } else {
      console.log(`[LYRIC] 获取歌词失败：${response.msg || '未知错误'}`);
      return {
        success: false,
        lyric: null,
        message: response.msg || '暂无歌词'
      };
    }
  } catch (error) {
    console.error(`[LYRIC] ⚠️  获取歌词出错：${error.message}`);
    return {
      success: false,
      lyric: null,
      message: '获取歌词失败'
    };
  }
}

async function downloadMusic(cookie, musicInfo, options = {}) {
  const { downloadLyric = true, onProgress = null, downloadDir } = options;
  const { title, artist } = musicInfo;

  const result = {
    success: false,
    files: [],
    errors: []
  };

  try {
    const artistDir = path.join(downloadDir, sanitizeFilename(artist));
    ensureDirectory(artistDir);

    if (onProgress) onProgress('getting_url', title, artist);

    const urlResult = await getDownloadUrl(cookie, musicInfo);

    if (!urlResult.success) {
      result.errors.push(`获取 "${title}" 下载地址失败 - ${urlResult.message}`);
      return result;
    }

    if (onProgress) onProgress('downloading_music', title, artist);

    const safeTitle = sanitizeFilename(title);
    const ext = urlResult.format.toLowerCase() === 'flac' ? '.flac' : '.mp3';
    const musicFilePath = path.join(artistDir, `${safeTitle}${ext}`);

    console.log(`\n[DOWNLOAD] 🎵 ${title} - ${artist}`);
    console.log(`[DOWNLOAD] 格式：${urlResult.format}，大小：~${formatFileSize(urlResult.size)}`);
    console.log(`[DOWNLOAD] 保存到：${path.relative(downloadDir, musicFilePath)}\n`);

    const musicDownloaded = await downloadFile(
      urlResult.url,
      musicFilePath,
      (received, total) => {
        if (onProgress && total > 0) {
          onProgress('progress', title, artist, received, total);
        }
      }
    );

    if (musicDownloaded) {
      result.files.push(musicFilePath);
      console.log(`[DOWNLOAD] ✅ 音乐文件保存成功\n`);
    } else {
      result.errors.push(`下载 "${title}" 音乐文件失败`);
      return result;
    }

    if (downloadLyric) {
      if (onProgress) onProgress('downloading_lyric', title, artist);

      const lyricResult = await getLyric(cookie, musicInfo);

      if (lyricResult.success && lyricResult.lyric) {
        const lyricFilePath = path.join(artistDir, `${safeTitle}.lrc`);

        try {
          fs.writeFileSync(lyricFilePath, lyricResult.lyric, 'utf8');
          result.files.push(lyricFilePath);
          console.log(`[DOWNLOAD] ✅ 歌词已保存：${safeTitle}.lrc\n`);
        } catch (writeError) {
          console.error(`[DOWNLOAD] ⚠️  歌词保存失败：${writeError.message}\n`);
          result.errors.push(`保存 "${title}" 歌词失败`);
        }
      } else {
        console.log(`[DOWNLOAD] ℹ️  "${title}" 暂无歌词，跳过...\n`);
      }

      await sleep(500);
    }

    result.success = true;
    return result;

  } catch (error) {
    console.error(`[DOWNLOAD] ❌ 下载 "${title}" 出错：${error.message}\n`);
    result.errors.push(`"${title}" 下载失败 - ${error.message}`);
    return result;
  }
}

async function batchDownload(cookie, musicList, options = {}) {
  const {
    downloadLyric = true,
    stopOnError = false,
    onProgress = null,
    onItemComplete = null,
    downloadDir
  } = options;

  const summary = {
    total: musicList.length,
    success: 0,
    failed: 0,
    skipped: 0,
    startTime: Date.now()
  };

  const results = [];

  console.log('\n' + '='.repeat(60));
  console.log('📦 批量下载开始'.padEnd(40));
  console.log(`📁 下载目录：${downloadDir}`);
  console.log('='.repeat(60));
  console.log(`待下载歌曲数量：${musicList.length}\n`);

  for (let i = 0; i < musicList.length; i++) {
    const music = musicList[i];
    const currentNum = i + 1;

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`⬇️  正在处理 (${currentNum}/${musicList.length})：${music.title} - ${music.artist}`);
    console.log(`${'─'.repeat(50)}\n`);

    if (onProgress) {
      onProgress(currentNum, musicList.length, music.title, music.artist);
    }

    try {
      const result = await downloadMusic(cookie, music, {
        downloadLyric,
        downloadDir,
        onProgress: (status, title, artist, received, total) => {
          if (status === 'progress') {
            process.stdout.write(`\r   [进度] ${formatFileSize(received)} / ${formatFileSize(total)}`);
          }
        }
      });

      results.push({
        index: currentNum,
        title: music.title,
        artist: music.artist,
        ...result
      });

      if (result.success) {
        summary.success++;
        console.log(`✅ 已完成：${music.title} - ${music.artist}`);
      } else {
        summary.failed++;
        console.log(`❌ 失败：${music.title} - ${music.artist}`);

        if (stopOnError) {
          console.log('\n⛔ 因错误停止（stopOnError=true）');
          break;
        }
      }

      if (onItemComplete) {
        onItemComplete(currentNum, musicList.length, result, music);
      }

      if (i < musicList.length - 1) {
        await sleep(1000);
      }

    } catch (error) {
      summary.failed++;
      results.push({
        index: currentNum,
        title: music.title,
        artist: music.artist,
        success: false,
        files: [],
        errors: [error.message]
      });

      console.error(`❌ 意外错误：${error.message}`);

      if (stopOnError) break;
    }
  }

  summary.endTime = Date.now();
  summary.durationMs = summary.endTime - summary.startTime;
  summary.durationFormatted = formatDuration(summary.durationMs / 1000);

  console.log('\n' + '='.repeat(60));
  console.log('📊 下载汇总'.padEnd(45));
  console.log('='.repeat(60));
  console.log(`✅ 成功：${summary.success}/${summary.total}`);
  console.log(`❌ 失败：${summary.failed}/${summary.total}`);
  console.log(`⏱️  耗时：${summary.durationFormatted}`);
  console.log('='.repeat(60) + '\n');

  return { summary, results };
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

module.exports = {
  getDownloadUrl,
  getLyric,
  downloadMusic,
  batchDownload
};