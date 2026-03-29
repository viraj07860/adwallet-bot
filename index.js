require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const CHANNEL = "@AdWalletCommunity";
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== DATA =====
const users = {};
const withdrawals = [];

// ===== DAILY LIMIT FUNCTION =====
function checkDailyLimit(user) {
  const now = Date.now();

  if (now - user.lastReset > 86400000) {
    user.dailyAds = 0;
    user.lastReset = now;
  }

  return user.dailyAds < 20;
}

// ===== BOT START =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  const startPayload = ctx.payload;

  if (!users[userId]) {
    users[userId] = {
      balance: 0,
      tasks: 0,
      username,
      referralList: [],
      referralCount: 0,
      isSubscribed: false,
      lastAdTime: 0,
      dailyAds: 0,
      lastReset: Date.now()
    };

    // 🎯 Referral reward
    if (startPayload && users[startPayload] && startPayload != userId) {
      users[startPayload].balance += 5;
      users[startPayload].referralList.push({
        username,
        date: new Date().toLocaleDateString()
      });
      users[startPayload].referralCount += 1;

      ctx.telegram.sendMessage(startPayload,
        `🎉 New Referral!\n👤 ${username}\n💰 ₹5 added`);
    }
  }

  return sendApp(ctx);
});

// ===== OPEN MINI APP =====
function sendApp(ctx) {
  const userId = ctx.from.id;
  const webAppUrl = `https://${process.env.RAILWAY_STATIC_URL}/?id=${userId}`;

  return ctx.reply("💰 Open AdzWallet:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Open App", web_app: { url: webAppUrl } }]
      ]
    }
  });
}

// ===== USER API =====
app.get('/user/:id', (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// ===== ADSGRAM REWARD (SECURE) =====
app.get('/api/reward', (req, res) => {
  const { userid, userId, key } = req.query;
  const finalUserId = userid || userId;

  if (key !== process.env.REWARD_SECRET) {
    return res.send("Unauthorized");
  }

  const user = users[finalUserId];
  if (!user) return res.send("User not found");

  const now = Date.now();

  // cooldown
  if (now - user.lastAdTime < 30000) {
    return res.send("Cooldown");
  }

  // daily limit
  if (!checkDailyLimit(user)) {
    return res.send("Daily limit reached");
  }

  user.balance += 20;
  user.tasks += 1;
  user.dailyAds += 1;
  user.lastAdTime = now;

  console.log("✅ Reward:", finalUserId);

  res.send("OK");
});

// ===== REFERRALS =====
app.get('/api/referrals/:id', (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    total: user.referralCount,
    list: user.referralList
  });
});

// ===== WITHDRAW =====
app.post('/api/withdraw', (req, res) => {
  const { userId, method, account } = req.body;

  const user = users[userId];
  if (!user) return res.json({ success: false });

  if (user.balance < 500) {
    return res.json({ success: false, message: "Min ₹500 required" });
  }

  withdrawals.push({
    userId,
    amount: user.balance,
    method,
    account,
    status: "pending",
    date: new Date()
  });

  user.balance = 0;

  console.log("💸 Withdraw:", withdrawals);

  res.json({ success: true });
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`✅ Server running on ${PORT}`);
  bot.launch();
});
