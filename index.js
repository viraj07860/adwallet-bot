require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== DATA (TEMP - will upgrade to MongoDB later) =====
const users = {};
const withdrawals = [];

// ===== DAILY LIMIT =====
function checkDailyLimit(user) {
  const now = Date.now();

  if (!user.lastReset || now - user.lastReset > 86400000) {
    user.dailyAds = 0;
    user.lastReset = now;
  }

  return user.dailyAds < 20;
}

// ===== BOT START =====
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name;
  const ref = ctx.startPayload;

  // create user
  if (!users[userId]) {
    users[userId] = {
      userId,
      username,
      balance: 0,
      tasks: 0,
      referralCount: 0,
      referralList: [],
      lastAdTime: 0,
      dailyAds: 0,
      lastReset: Date.now()
    };

    // 🎯 referral reward
    if (ref && ref !== userId && users[ref]) {
      users[ref].balance += 5;
      users[ref].referralCount += 1;
      users[ref].referralList.push({
        username,
        date: new Date().toLocaleDateString()
      });

      ctx.telegram.sendMessage(ref,
        `🎉 New referral!\n👤 ${username}\n💰 ₹5 added`
      );
    }
  }

  // open web app
  const url = `https://${process.env.RAILWAY_STATIC_URL}/?id=${userId}`;

  return ctx.reply("🚀 Open AdzWallet", {
    reply_markup: {
      inline_keyboard: [[
        { text: "💰 Open App", web_app: { url } }
      ]]
    }
  });
});

// ===== USER DATA =====
app.get('/user/:id', (req, res) => {
  const user = users[req.params.id];

  if (!user) {
    return res.json({
      balance: 0,
      tasks: 0,
      referralCount: 0
    });
  }

  res.json(user);
});

// ===== ADSGRAM REWARD (SECURE) =====
app.get('/api/reward', (req, res) => {
  const { userid, userId, key } = req.query;
  const id = userid || userId;

  if (key !== process.env.REWARD_SECRET) {
    return res.send("Unauthorized ❌");
  }

  const user = users[id];
  if (!user) return res.send("User not found ❌");

  const now = Date.now();

  // cooldown
  if (now - user.lastAdTime < 30000) {
    return res.send("Cooldown ⏳");
  }

  // daily limit
  if (!checkDailyLimit(user)) {
    return res.send("Daily limit reached ❌");
  }

  // reward
  user.balance += 20;
  user.tasks += 1;
  user.dailyAds += 1;
  user.lastAdTime = now;

  console.log("✅ Reward:", id);

  res.send("OK");
});

// ===== WITHDRAW =====
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, account } = req.body;

  const user = users[userId];

  if (!user) {
    return res.json({ success: false, message: "User not found" });
  }

  if (!amount || amount <= 0) {
    return res.json({ success: false, message: "Invalid amount" });
  }

  if (user.balance < amount) {
    return res.json({ success: false, message: "Insufficient balance" });
  }

  if (amount < 100) {
    return res.json({ success: false, message: "Minimum ₹100 withdrawal" });
  }

  withdrawals.push({
    userId,
    amount,
    method,
    account,
    status: "pending",
    date: new Date()
  });

  user.balance -= amount;

  console.log("💸 Withdraw:", userId, amount, method);

  res.json({ success: true });
});

// ===== REFERRALS =====
app.get('/api/referrals/:id', (req, res) => {
  const user = users[req.params.id];

  if (!user) {
    return res.json({ total: 0, list: [] });
  }

  res.json({
    total: user.referralCount,
    list: user.referralList
  });
});

// ===== ADMIN (basic) =====
app.get('/admin/withdrawals', (req, res) => {
  res.json(withdrawals);
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`✅ Server running on ${PORT}`);
  bot.launch();
});

// graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
