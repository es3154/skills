const fs = require('fs');
const path = require('path');

const CART_FILE = path.join(__dirname, '../../cache/cart.json');
const MAX_CART_SIZE = 50;

function ensureCartDir() {
  const cartDir = path.dirname(CART_FILE);
  if (!fs.existsSync(cartDir)) {
    fs.mkdirSync(cartDir, { recursive: true });
  }
}

function loadCart() {
  try {
    if (!fs.existsSync(CART_FILE)) {
      return [];
    }
    const content = fs.readFileSync(CART_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`[CART] 加载购物车失败：${error.message}`);
    return [];
  }
}

function saveCart(cart) {
  try {
    ensureCartDir();
    fs.writeFileSync(CART_FILE, JSON.stringify(cart, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`[CART] 保存购物车失败：${error.message}`);
    return false;
  }
}

function addToCart(songs) {
  const cart = loadCart();
  const existingIds = new Set(cart.map(s => `${s.id}-${s.sign}`));

  let addedCount = 0;
  let skippedCount = 0;
  const newSongs = [];

  for (const song of songs) {
    const key = `${song.id}-${song.sign}`;
    if (!existingIds.has(key)) {
      if (cart.length + newSongs.length >= MAX_CART_SIZE) {
        console.log(`[CART] ⚠️  购物车已满（最多 ${MAX_CART_SIZE} 首），跳过：${song.title}`);
        skippedCount++;
        continue;
      }
      newSongs.push({
        ...song,
        cartIndex: cart.length + newSongs.length + 1
      });
      addedCount++;
    } else {
      skippedCount++;
    }
  }

  if (newSongs.length > 0) {
    const updatedCart = [...cart, ...newSongs];
    saveCart(updatedCart);
  }

  return {
    success: true,
    added: addedCount,
    skipped: skippedCount,
    total: cart.length + newSongs.length
  };
}

function getCart() {
  return loadCart();
}

function removeFromCart(indices) {
  const cart = loadCart();
  const validIndices = indices.filter(i => i >= 1 && i <= cart.length);

  if (validIndices.length === 0) {
    return { success: false, message: '无效的序号' };
  }

  const newCart = cart.filter((_, idx) => !validIndices.includes(idx + 1));

  newCart.forEach((song, idx) => {
    song.cartIndex = idx + 1;
  });

  saveCart(newCart);

  return { success: true, removed: validIndices.length, remaining: newCart.length };
}

function clearCart() {
  saveCart([]);
  return { success: true };
}

function formatCartTable(cart) {
  if (cart.length === 0) {
    return '\n🛒 购物车为空\n';
  }

  const lines = [];
  lines.push('\n' + '='.repeat(90));
  lines.push('🛒 购物车'.padEnd(45) + `📦 ${cart.length} 首歌曲`);
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

  cart.forEach((song, index) => {
    const num = (index + 1).toString().padEnd(6);
    const title = truncateString(song.title, 26).padEnd(28);
    const artist = truncateString(song.artist, 18).padEnd(20);
    const album = truncateString(song.album, 16).padEnd(18);
    const format = song.format.padEnd(8);
    const size = formatFileSize(song.size);

    lines.push(`${num}|${title}|${artist}|${album}|${format}|${size}`);
  });

  lines.push('='.repeat(90));
  lines.push('');

  return lines.join('\n');
}

function truncateString(str, maxLength) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

function formatFileSize(size) {
  if (!size) return '未知';
  if (typeof size === 'string') return size;
  const bytes = parseInt(size);
  if (isNaN(bytes) || bytes === 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

module.exports = {
  addToCart,
  getCart,
  removeFromCart,
  clearCart,
  formatCartTable,
  getCartFile: () => CART_FILE,
  getMaxCartSize: () => MAX_CART_SIZE
};