require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== IN-MEMORY DATABASE =====
const users = {};

// ===== DEBUG LOG =====
bot.use((ctx, next) => {
  console.log("📩 Update:", ctx.updateType, ctx.message?.text);
  return next();
});

// ===== START COMMAND =====
bot.start(async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const name = ctx.from.first_name || "User";

    console.log("🔥 /start triggered:", userId);

    // create user if not exists
    if (!users[userId]) {
      users[userId] = {
        balance: 0,
        tasks: 0,
        referralList: [],
        withdrawals: []
      };
    }

    const webAppUrl = `${process.env.WEBAPP_URL}/?id=${userId}`;

    await ctx.reply(`👋 Welcome ${name}!\n\nStart earning now 🚀`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💰 Open AdzWallet", web_app: { url: webAppUrl } }]
        ]
      }
    });

  } catch (err) {
    console.error("❌ START ERROR:", err);
  }
});

// ===== GET USER =====
app.get('/user/:id', (req, res) => {
  const id = req.params.id;
  if (!users[id]) return res.json({ balance: 0, referralCount: 0 });

  res.json({
    balance: users[id].balance,
    referralCount: users[id].referralList.length
  });
});

// ===== REWARD API =====
app.get('/api/reward', (req, res) => {
  const { userid, key } = req.query;

  if (key !== process.env.REWARD_SECRET) {
    return res.status(403).send("Invalid key");
  }

  if (!userid || !users[userid]) {
    return res.status(400).send("User not found");
  }

  users[userid].balance += 0.08;
  users[userid].tasks += 1;

  console.log(`💰 Reward added to ${userid}`);

  res.send("OK");
});

// ===== WITHDRAW =====
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, account } = req.body;

  if (!users[userId]) {
    return res.json({ success: false, message: "User not found" });
  }

  if (amount < 10) {
    return res.json({ success: false, message: "Minimum $10" });
  }

  if (amount > users[userId].balance) {
    return res.json({ success: false, message: "Insufficient balance" });
  }

  users[userId].balance -= amount;

  users[userId].withdrawals.push({
    amount,
    method,
    account,
    date: new Date()
  });

  console.log(`💸 Withdraw: ${userId} → ${amount}`);

  res.json({ success: true });
});

// ===== START SERVER =====
app.listen(PORT, async () => {
  console.log(`✅ Server running on ${PORT}`);

  try {
    await bot.launch({ dropPendingUpdates: true });
    console.log("🤖 Bot started successfully");
  } catch (err) {
    console.error("❌ Bot launch error:", err);
  }
});

// ===== STOP HANDLER =====
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
