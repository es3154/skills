# music-helper

无损音乐搜索下载工具，支持从 flac.music.hi.cn 搜索和下载音乐。

> **免责声明**：本工具仅供学习交流使用，请勿用于商业盈利或任何非法用途。使用者需自行承担使用本工具的一切后果。

## 功能特性

- 音乐搜索 - 支持关键字搜索歌手、歌曲等
- 批量下载 - 支持同时下载多首歌曲及歌词
- 购物车功能 - 先收藏歌曲，后统一下载
- Cookie 自动管理 - 自动检测和刷新过期 Cookie
- 分页显示 - 每页 10 条搜索结果

## 目录结构

```
music-helper/
├── scripts/
│   ├── index.js          # CLI 主入口
│   ├── core/
│   │   ├── api.js        # API 接口封装
│   │   ├── search.js     # 搜索模块
│   │   ├── download.js   # 下载模块
│   │   ├── cookie-manager.js  # Cookie 管理
│   │   └── cart.js      # 购物车模块
│   └── utils/
│       └── helpers.js    # 工具函数
├── cache/                # 缓存目录
│   ├── search_cache.json # 搜索缓存
│   ├── cart.json         # 购物车数据
│   └── cookie.json      # Cookie 缓存
├── SKILL.md             # 技能文档
└── README.md            # 本文档
```

## 命令行用法

```bash
# 搜索音乐
node scripts/index.js --search <关键词>

# 下载歌曲（序号从搜索结果获取）
node scripts/index.js --download <序号列表> --dir <下载目录>

# 添加到购物车
node scripts/index.js --add <序号列表>

# 查看购物车
node scripts/index.js --cart

# 从购物车移除
node scripts/index.js --remove <序号列表>

# 清空购物车
node scripts/index.js --clear

# 结算购物车（下载购物车中所有歌曲）
node scripts/index.js --checkout --dir <下载目录>

# 翻页（显示更多搜索结果）
node scripts/index.js --next

# 手动设置 Cookie
node scripts/index.js --cookie <cookie字符串>
```

## 命令说明

| 命令 | 说明 | 示例 |
|------|------|------|
| `--search` | 搜索音乐 | `--search 五月天` |
| `--download` | 下载歌曲 | `--download 1,2,3` |
| `--dir` | 下载目录 | `--dir D:\Music` |
| `--add` | 添加到购物车 | `--add 1,2` |
| `--cart` | 查看购物车 | `--cart` |
| `--remove` | 从购物车移除 | `--remove 1` |
| `--clear` | 清空购物车 | `--clear` |
| `--checkout` | 结算购物车 | `--checkout` |
| `--next` | 翻页查看更多 | `--next` |
| `--cookie` | 手动设置 Cookie | `--cookie xxx` |

## 使用示例

### 搜索并下载

```bash
# 1. 搜索歌曲
node scripts/index.js --search 倔强

# 2. 下载第 1 和第 3 首
node scripts/index.js --download 1,3 --dir ./download
```

### 使用购物车

```bash
# 1. 搜索并添加歌曲到购物车
node scripts/index.js --search 周杰伦
node scripts/index.js --add 1,2,3

# 2. 再次搜索，添加更多歌曲
node scripts/index.js --search 陈奕迅
node scripts/index.js --add 1

# 3. 查看购物车
node scripts/index.js --cart

# 4. 移除不需要的
node scripts/index.js --remove 2

# 5. 统一下载
node scripts/index.js --checkout --dir ./download
```

## 配置说明

### Cookie 管理

Cookie 是访问 flac.music.hi.cn 的认证凭证，模块会自动：
- 检测 Cookie 是否过期
- 在需要时自动刷新 Cookie
- 支持手动设置 Cookie

手动设置 Cookie：
```bash
node scripts/index.js --cookie "your_cookie_here"
```

### 搜索缓存

搜索结果会缓存到 `cache/search_cache.json`，缓存有效期约 10 分钟。

### 购物车限制

- 最大存储 50 首歌曲
- 购物车数据持久化到 `cache/cart.json`

## 依赖项

```bash
npm install
```

主要依赖：
- `puppeteer-extra` - 浏览器自动化
- `puppeteer-extra-plugin-stealth` - 隐身插件
- `puppeteer-core` - Puppeteer 核心库

## 开源协议

MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
