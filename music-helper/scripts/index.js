const path = require('path');
const fs = require('fs');
const { createAPI } = require('./core/api');
const { getSongsFromCacheByIndices } = require('./core/search');
const { addToCart, getCart, removeFromCart, clearCart, formatCartTable } = require('./core/cart');

if (process.platform === 'win32') {
  require('child_process').execSync('chcp 65001 >nul', { stdio: 'ignore' });
}

process.stdout.setEncoding('utf8');

async function main() {
  const args = process.argv.slice(2);

  console.log('\n' + '='.repeat(70));
  console.log('🎵 Music Helper - 无损音乐搜索下载工具'.padEnd(55));
  console.log('='.repeat(70));
  console.log('');
  console.log('使用方法:');
  console.log('  node index.js --search <关键词>            - 搜索音乐（结果缓存）');
  console.log('  node index.js --search <关键词> --page <n> - 搜索并跳转到第n页');
  console.log('  node index.js --next                      - 下一页（搜索后使用）');
  console.log('  node index.js --add <序号>                 - 添加到购物车（如 1,3,5）');
  console.log('  node index.js --cart                     - 查看购物车');
  console.log('  node index.js --remove <序号>              - 从购物车移除（如 1,3）');
  console.log('  node index.js --clear                    - 清空购物车');
  console.log('  node index.js --checkout --dir <路径>     - 下载购物车全部歌曲');
  console.log('  node index.js --download <序号> --dir <路径> - 直接下载（不经过购物车）');
  console.log('  node index.js --cookie <字符串>           - 手动设置cookie');
  console.log('  node index.js --help                      - 显示此帮助');
  console.log('');

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.exit(0);
  }

  const commands = ['--search', '--next', '--add', '--cart', '--remove', '--clear', '--checkout', '--download', '--cookie'];
  const activeCommands = commands.filter(cmd => args.includes(cmd));
  if (activeCommands.length > 1) {
    console.error('❌ 错误：每次只能执行一个命令');
    console.error('   命令互斥：--search, --add, --cart, --remove, --clear, --checkout, --download, --cookie');
    process.exit(1);
  }

  const dirIndex = args.indexOf('--dir');
  const downloadDir = dirIndex !== -1 && args[dirIndex + 1]
    ? path.resolve(args[dirIndex + 1])
    : path.resolve(__dirname, '../downloads');

  const api = createAPI({ downloadDir });

  const searchIndex = args.indexOf('--search');
  if (searchIndex !== -1 && args[searchIndex + 1]) {
    const pageIndex = args.indexOf('--page');
    let page = 1;
    if (pageIndex !== -1 && args[pageIndex + 1]) {
      page = parseInt(args[pageIndex + 1]);
      if (isNaN(page) || page < 1) {
        console.error('❌ 无效的页码。页码必须是正整数。\n');
        process.exit(1);
      }
    }

    const searchArgs = args.slice(searchIndex + 1);
    const pageArgIndex = searchArgs.indexOf('--page');
    const actualKeyword = pageArgIndex !== -1
      ? searchArgs.slice(0, pageArgIndex).join(' ')
      : searchArgs.join(' ');

    try {
      const result = await api.search(actualKeyword, { page });
      console.log(result.formattedTable);
      const totalPages = Math.ceil(result.total / 10);
      console.log(`\n✅ 找到 ${result.total} 条结果${page > 1 ? `，显示第 ${page}/${totalPages} 页` : ''}`);
      if (result.hasMore) {
        console.log('💡 提示：使用 --next 查看更多结果\n');
      } else {
        console.log('');
      }
      console.log(`📁 结果已缓存，可用于下载\n`);
    } catch (error) {
      console.error('❌ 搜索错误：', error.message);
      process.exit(1);
    }
    return;
  }

  const nextIndex = args.indexOf('--next');
  if (nextIndex !== -1) {
    try {
      const cachePath = path.join(__dirname, '../cache/search_cache.json');
      if (!fs.existsSync(cachePath)) {
        console.error('❌ 缓存中未找到之前的搜索，请先搜索。\n');
        process.exit(1);
      }
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const keyword = cache.keyword;
      const nextPage = (cache.page || 1) + 1;
      const totalPages = Math.ceil(cache.total / 10);
      if (nextPage > totalPages) {
        console.error(`❌ 已经是最后一页（共 ${totalPages} 页），没有更多结果。\n`);
        process.exit(1);
      }
      const result = await api.search(keyword, { page: nextPage });
      console.log(result.formattedTable);
      console.log(`\n✅ 找到 ${result.total} 条结果，显示第 ${nextPage}/${totalPages} 页`);
      console.log(`📁 结果已缓存，可用于下载\n`);
    } catch (error) {
      console.error('❌ 翻页错误：', error.message);
      process.exit(1);
    }
    return;
  }

  const addIndex = args.indexOf('--add');
  if (addIndex !== -1 && args[addIndex + 1]) {
    const indicesStr = args[addIndex + 1];
    const indices = indicesStr.split(',').map(i => parseInt(i.trim())).filter(i => !isNaN(i));

    if (indices.length === 0) {
      console.error('❌ 无效的序号格式！使用方法：--add 1,3,5\n');
      process.exit(1);
    }

    const songs = getSongsFromCacheByIndices(indices);
    if (songs.length === 0) {
      console.error('❌ 缓存中未找到有效歌曲，请先搜索。\n');
      process.exit(1);
    }

    const result = addToCart(songs);
    if (result.added > 0) {
      console.log(`🛒 已添加 ${result.added} 首歌曲到购物车（共 ${result.total} 首）\n`);
    }
    if (result.skipped > 0) {
      console.log(`ℹ️  跳过了 ${result.skipped} 首重复歌曲\n`);
    }
    return;
  }

  const cartIndex = args.indexOf('--cart');
  if (cartIndex !== -1) {
    const cart = getCart();
    console.log(formatCartTable(cart));
    return;
  }

  const removeIndex = args.indexOf('--remove');
  if (removeIndex !== -1 && args[removeIndex + 1]) {
    const indicesStr = args[removeIndex + 1];
    const indices = indicesStr.split(',').map(i => parseInt(i.trim())).filter(i => !isNaN(i));

    if (indices.length === 0) {
      console.error('❌ 无效的序号格式！使用方法：--remove 1,3\n');
      process.exit(1);
    }

    const result = removeFromCart(indices);
    if (result.success) {
      console.log(`🛒 已从购物车移除 ${result.removed} 首歌曲（剩余：${result.remaining} 首）\n`);
    } else {
      console.error('❌ 移除歌曲失败：', result.message, '\n');
      process.exit(1);
    }
    return;
  }

  const clearIndex = args.indexOf('--clear');
  if (clearIndex !== -1) {
    clearCart();
    console.log('🛒 购物车已清空\n');
    return;
  }

  const checkoutIndex = args.indexOf('--checkout');
  if (checkoutIndex !== -1) {
    const cart = getCart();
    if (cart.length === 0) {
      console.error('❌ 购物车为空。请先用 --add 添加歌曲\n');
      process.exit(1);
    }

    const checkoutDir = dirIndex !== -1 && args[dirIndex + 1]
      ? path.resolve(args[dirIndex + 1])
      : path.resolve(__dirname, '../downloads');

    console.log(`\n🛒 正在结算 ${cart.length} 首歌曲到：${checkoutDir}\n`);

    try {
      const result = await api.downloadFromCart({ downloadDir: checkoutDir });

      if (result.success) {
        console.log(`\n🎉 结算完成！`);
        console.log(`✅ 成功下载：${result.downloaded} 首歌曲`);
        console.log(`📁 位置：${checkoutDir}`);

        if (result.failed > 0) {
          console.log(`\n⚠️  失败：${result.failed} 首歌曲`);
        }
      } else {
        console.log('\n❌ 下载失败！');
        if (result.errors.length > 0) {
          console.log('错误：', result.errors);
        }
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ 下载错误：', error.message);
      process.exit(1);
    }
    return;
  }

  const downloadIndex = args.indexOf('--download');
  if (downloadIndex !== -1 && args[downloadIndex + 1]) {
    if (dirIndex === -1 || !args[dirIndex + 1]) {
      console.error('❌ 错误：下载时需要 --dir 参数');
      console.error('使用方法：node index.js --download <序号> --dir <路径>');
      process.exit(1);
    }

    const indicesStr = args[downloadIndex + 1];
    const indices = indicesStr.split(',').map(i => parseInt(i.trim())).filter(i => !isNaN(i));

    if (indices.length === 0) {
      console.error('❌ 无效的序号格式！使用方法：--download 1,3,5\n');
      process.exit(1);
    }

    try {
      const result = await api.download(indices);

      if (result.success) {
        console.log(`\n🎉 下载完成！`);
        console.log(`✅ 成功下载：${result.downloaded} 首歌曲`);
        console.log(`📁 位置：${downloadDir}`);

        if (result.failed > 0) {
          console.log(`\n⚠️  失败：${result.failed} 首歌曲`);
        }
      } else {
        console.log('\n❌ 下载失败！');
        if (result.errors.length > 0) {
          console.log('错误：', result.errors);
        }
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ 下载错误：', error.message);
      process.exit(1);
    }
    return;
  }

  const cookieIndex = args.indexOf('--cookie');
  if (cookieIndex !== -1 && args[cookieIndex + 1]) {
    const cookieValue = args[cookieIndex + 1];
    console.log('\n🔧 正在设置手动 cookie...');
    try {
      await api.setCookie(cookieValue);
      console.log('✅ Cookie 保存成功！\n');
    } catch (error) {
      console.error('❌ 保存 cookie 失败：', error.message);
      process.exit(1);
    }
    return;
  }

  console.error('❌ 未知命令！');
  console.error('   运行 "node index.js --help" 查看使用方法\n');
  process.exit(1);
}

main().catch(error => {
  console.error('致命错误：', error.message);
  process.exit(1);
});