require('dotenv').config();

const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());

// ✅ FIX: Proper static folder
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;

// ===== CHECK ENV =====
if (!process.env.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing in .env");
  process.exit(1);
}

// ===== BOT =====
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== IN-MEMORY DATA =====
const users = {};
const lastAdWatch = {};
const dailyLimit = {};

// ===== BOT START =====
bot.start((ctx) => {
  const userId = ctx.from.id;

  if (!users[userId]) {
    users[userId] = { balance: 0, tasks: 0 };
  }

  ctx.reply('🚀 AdWallet is Live!', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "💰 Open App",
            web_app: {
              url: "https://adwallet-bot-production.up.railway.app/"
            }
          }
        ]
      ]
    }
  });
});

// ===== LAUNCH BOT =====
(async () => {
  try {
    console.log("Starting bot...");
    await bot.launch();
    console.log("Bot started ✅");
  } catch (err) {
    console.error("Bot error:", err);
  }
})();

// ===== API: GET USER =====
app.get('/user/:id', (req, res) => {
  const id = req.params.id;

  if (!users[id]) {
    users[id] = { balance: 0, tasks: 0 };
  }

  res.json(users[id]);
});

// ===== API: TASK LIST =====
app.get('/tasks', (req, res) => {
  res.json([
    { title: "Watch Ad", reward: 20, type: "adsgram" },
    { title: "Join Channel", reward: 10, link: "https://t.me/AdWalletCommunity" }
  ]);
});

// ===== API: ADSGRAM REWARD =====
app.get('/api/adsgram-reward', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const now = Date.now();

  if (!users[userId]) {
    users[userId] = { balance: 0, tasks: 0 };
  }

  // ⏳ Cooldown
  if (lastAdWatch[userId] && now - lastAdWatch[userId] < 30000) {
    return res.status(429).json({ error: "⏳ Wait 30 seconds" });
  }

  // 📅 Daily limit
  const today = new Date().toDateString();

  if (!dailyLimit[userId]) {
    dailyLimit[userId] = { count: 0, date: today };
  }

  if (dailyLimit[userId].date !== today) {
    dailyLimit[userId] = { count: 0, date: today };
  }

  if (dailyLimit[userId].count >= 10) {
    return res.status(403).json({ error: "🚫 Daily limit reached" });
  }

  // 💰 Reward
  const reward = 20;
  users[userId].balance += reward;
  users[userId].tasks += 1;

  lastAdWatch[userId] = now;
  dailyLimit[userId].count++;

  res.json({
    success: true,
    reward,
    balance: users[userId].balance
  });
});

// ===== ROOT FIX (IMPORTANT) =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== START SERVER =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
