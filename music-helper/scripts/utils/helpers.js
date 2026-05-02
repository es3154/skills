const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * 工具函数模块
 * 提供HTTP请求、文件操作、格式化等通用功能
 */

/**
 * 清理文件名中的特殊字符，避免Windows系统无法创建文件
 * @param {string} filename - 原始文件名
 * @returns {string} - 清理后的文件名
 */
function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} - 格式化后的大小（如 "32.5 MB"）
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = (bytes / Math.pow(k, i)).toFixed(1);
  
  return `${size} ${units[i]}`;
}

/**
 * 发送 HTTP POST 请求（支持 HTTP 和 HTTPS）
 * @param {string} url - 请求URL
 * @param {Object} options - 请求选项（headers 等）
 * @param {string} data - 请求体数据
 * @param {number} retryCount - 重试次数（默认 3）
 * @param {number} delay - 重试延迟（毫秒，默认 1000）
 * @returns {Promise<Object>} - 响应结果
 */
async function sendPostRequest(url, options, data, retryCount = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https://');
        const httpModule = isHttps ? https : http;

        const req = httpModule.request(url, options, (res) => {
          const chunks = [];

          res.on('data', (chunk) => {
            chunks.push(Buffer.from(chunk));
          });

          res.on('end', () => {
            if (res.statusCode !== 200) {
              const responseText = Buffer.concat(chunks).toString('utf8');
              reject(new Error(`HTTP ${res.statusCode}: ${responseText.substring(0, 200)}`));
              return;
            }

            try {
              const responseBuffer = Buffer.concat(chunks);
              const responseText = responseBuffer.toString('utf8');
              const parsedData = JSON.parse(responseText);
              resolve(parsedData);
            } catch (error) {
              const responseText = Buffer.concat(chunks).toString('utf8');
              if (responseText.includes('<html')) {
                reject(new Error('HTML_RESPONSE: Cookie may be invalid or expired'));
              } else {
                reject(new Error(`JSON_PARSE_ERROR: ${error.message}`));
              }
            }
          });
        });
        
        req.on('error', (error) => {
          reject(new Error(`REQUEST_ERROR: ${error.message}`));
        });
        
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('TIMEOUT: Request timeout'));
        });
        
        req.setTimeout(30000); // 30 秒超时
        
        if (data) {
          req.write(data);
        }
        req.end();
      });
    } catch (error) {
      if (attempt < retryCount) {
        console.log(`⚠️  Request failed (attempt ${attempt}/${retryCount}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

/**
 * 下载文件到本地
 * @param {string} url - 文件URL
 * @param {string} savePath - 保存路径
 * @param {Function} onProgress - 进度回调函数 (received, total)
 * @returns {Promise<boolean>} - 是否成功
 */
async function downloadFile(url, savePath, onProgress = null) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const httpModule = isHttps ? https : http;
    
    const file = fs.createWriteStream(savePath);
    
    httpModule.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      
      const totalSize = parseInt(response.headers['content-length'], 10) || 0;
      let downloadedSize = 0;
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (onProgress && totalSize > 0) {
          onProgress(downloadedSize, totalSize);
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
      
    }).on('error', (err) => {
      fs.unlink(savePath, () => {}); // 删除部分下载的文件
      reject(err);
    });
  });
}

/**
 * 确保目录存在，不存在则创建
 * @param {string} dirPath - 目录路径
 */
function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 解析用户输入的序号选择
 * @param {string} input - 用户输入（如 "1,2,3" 或 "1-5"）
 * @param {number} maxIndex - 最大有效序号
 * @returns {Array<number>} - 解析后的序号数组
 */
function parseUserSelection(input, maxIndex) {
  if (!input || !input.trim()) {
    return [];
  }
  
  const selections = [];
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  
  for (const part of parts) {
    if (part.includes('-')) {
      // 处理范围：如 "1-5"
      const [start, end] = part.split('-').map(n => parseInt(n.trim()));
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          if (i >= 1 && i <= maxIndex && !selections.includes(i)) {
            selections.push(i);
          }
        }
      }
    } else {
      // 单个序号
      const num = parseInt(part);
      if (!isNaN(num) && num >= 1 && num <= maxIndex && !selections.includes(num)) {
        selections.push(num);
      }
    }
  }
  
  return selections.sort((a, b) => a - b);
}

/**
 * 验证用户输入的选择是否有效
 * @param {string} input - 用户输入
 * @param {number} maxIndex - 最大有效序号
 * @returns {{ valid: boolean, selections: Array<number>, invalidItems: Array<string> }}
 */
function validateSelection(input, maxIndex) {
  const selections = parseUserSelection(input, maxIndex);
  const allParts = input.split(',').map(s => s.trim()).filter(Boolean);
  const validNumbers = selections.map(s => s.toString());
  const invalidItems = allParts.filter(p => !validNumbers.includes(p.replace(/\s/g, '')));
  
  return {
    valid: selections.length > 0,
    selections,
    invalidItems
  };
}

/**
 * 延迟执行
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  sanitizeFilename,
  formatFileSize,
  sendPostRequest,
  downloadFile,
  ensureDirectory,
  parseUserSelection,
  validateSelection,
  sleep
};
