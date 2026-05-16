const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = 6667;
const DATA_DIR = path.join(__dirname, 'data');
const USER_FILE = path.join(DATA_DIR, 'user.json');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const JWT_SECRET = process.env.JWT_SECRET || 'em_pro_' + require('crypto').randomBytes(16).toString('hex');
const JWT_SECRET_FILE = path.join(DATA_DIR, '.jwt_secret');

// 确保 data 目录
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 持久化 JWT_SECRET
let jwtSecret;
if (fs.existsSync(JWT_SECRET_FILE)) {
  jwtSecret = fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
} else {
  jwtSecret = JWT_SECRET;
  fs.writeFileSync(JWT_SECRET_FILE, jwtSecret);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ====== 辅助函数 ======
function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('Read error:', file, e.message); }
  return fallback;
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  } catch (e) { console.error('Write error:', file, e.message); }
}

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.userId = decoded.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token无效' });
  }
}

// ====== API 路由 ======

// 检查是否已注册
app.get('/api/check-user', (req, res) => {
  const user = readJSON(USER_FILE, null);
  res.json({ registered: !!user });
});

// 注册（仅允许一次）
app.post('/api/register', async (req, res) => {
  const existing = readJSON(USER_FILE, null);
  if (existing) return res.status(403).json({ error: '已有用户，不允许再注册' });

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (username.length < 2 || password.length < 4) return res.status(400).json({ error: '用户名≥2位，密码≥4位' });

  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(36), username, password: hash, created: new Date().toISOString() };
  writeJSON(USER_FILE, user);
  writeJSON(STORE_FILE, {});

  const token = jwt.sign({ userId: user.id, username }, jwtSecret, { expiresIn: '365d' });
  console.log(`[注册] 用户 ${username} 注册成功`);
  res.json({ ok: true, token, username });
});

// 登录
app.post('/api/login', async (req, res) => {
  const user = readJSON(USER_FILE, null);
  if (!user) return res.status(404).json({ error: '未注册' });

  const { username, password } = req.body;
  if (user.username !== username) return res.status(401).json({ error: '用户名错误' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: '密码错误' });

  const token = jwt.sign({ userId: user.id, username }, jwtSecret, { expiresIn: '365d' });
  console.log(`[登录] 用户 ${username} 登录成功`);
  res.json({ ok: true, token, username });
});

// 获取数据
app.get('/api/data', authMiddleware, (req, res) => {
  const data = readJSON(STORE_FILE, {});
  res.json(data);
});

// 保存数据
app.post('/api/data', authMiddleware, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: '无效数据' });
  writeJSON(STORE_FILE, data);
  res.json({ ok: true, size: JSON.stringify(data).length });
});

// 翻译代理（避免前端跨域）
app.get('/api/translate', async (req, res) => {
  const { text, from = 'en', to = 'zh-CN' } = req.query;
  if (!text) return res.json({ translation: '' });
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url);
    const d = await r.json();
    const translation = d?.[0]?.map(s => s[0]).join('') || '';
    res.json({ translation });
  } catch (e) {
    res.json({ translation: '', error: e.message });
  }
});

// 批量翻译
app.post('/api/translate-batch', async (req, res) => {
  const { texts, from = 'en', to = 'zh-CN' } = req.body;
  if (!texts || !Array.isArray(texts)) return res.json({ translations: [] });
  const results = [];
  for (const text of texts) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
      const r = await fetch(url);
      const d = await r.json();
      results.push(d?.[0]?.map(s => s[0]).join('') || text);
      await new Promise(r => setTimeout(r, 100)); // 限速
    } catch (e) {
      results.push(text);
    }
  }
  res.json({ translations: results });
});

// 所有其他路由返回 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`  EnglishMaster Pro 已启动`);
  console.log(`  端口: ${PORT}`);
  console.log(`  地址: http://0.0.0.0:${PORT}`);
  console.log(`  数据: ${DATA_DIR}`);
  console.log(`========================================\n`);
});
