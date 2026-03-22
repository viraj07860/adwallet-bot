require('dotenv').config();

const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;

// 🔥 CHANGE THIS TO YOUR CHANNEL
const CHANNEL = "@AdWalletCommunity";

// ===== BOT =====
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== DATA (TEMP STORAGE) =====
const users = {};
const lastAdWatch = {};
const dailyLimit = {};

// ===== START COMMAND (FORCE SUBSCRIBE) =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  if (!users[userId]) {
    users[userId] = { balance: 0, tasks: 0 };
  }

  try {
    const member = await ctx.telegram.getChatMember(CHANNEL, userId);

    if (["member", "administrator", "creator"].includes(member.status)) {
      return sendApp(ctx);
    }

  } catch (e) {
    console.log(e);
  }

  // ❌ Not subscribed
  ctx.reply("⭐ Please join our channel to continue", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📢 Join Channel",
            url: "https://t.me/AdWalletCommunity"
          }
        ],
        [
          {
            text: "✅ I Subscribed",
            callback_data: "check_sub"
          }
        ]
      ]
    }
  });
});

// ===== CHECK SUBSCRIBE BUTTON =====
bot.action("check_sub", async (ctx) => {
  const userId = ctx.from.id;

  try {
    const member = await ctx.telegram.getChatMember(CHANNEL, userId);

    if (["member", "administrator", "creator"].includes(member.status)) {

      await ctx.answerCbQuery("✅ Verified!");
      return sendApp(ctx);

    } else {
      ctx.answerCbQuery("❌ Join channel first!", { show_alert: true });
    }

  } catch (err) {
    ctx.answerCbQuery("⚠️ Error checking", { show_alert: true });
  }
});

// ===== OPEN APP =====
function sendApp(ctx) {
  return ctx.reply("🚀 Access granted!", {
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
}

// ===== SAFE BOT START =====
bot.launch()
  .then(() => console.log("Bot started ✅"))
  .catch(err => console.log("Bot error:", err.message));

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
    { title: "Watch Ad", reward: 20 },
    { title: "Join Channel", reward: 10 }
  ]);
});

// ===== API: ADS REWARD =====
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

// ===== ROOT =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== START SERVER =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
