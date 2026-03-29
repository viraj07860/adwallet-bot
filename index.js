require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const bot = new Telegraf(process.env.BOT_TOKEN);

const WEBAPP_URL = "https://adwallet-bot-production.up.railway.app";
const REWARD_SECRET = "adwallet7062";

/* ---------------- DATABASE (TEMP) ---------------- */
const users = {};

/* ---------------- BOT START ---------------- */
bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const name = ctx.from.first_name || "User";
  const ref = ctx.startPayload;

  // create user
  if (!users[userId]) {
    users[userId] = {
      balance: 0,
      referralCount: 0,
      referralEarnings: 0
    };

    // referral system
    if (ref && users[ref] && ref !== userId) {
      users[ref].balance += 0.075;
      users[ref].referralCount += 1;
      users[ref].referralEarnings += 0.075;

      ctx.telegram.sendMessage(ref, `👥 New referral joined! +$0.075`);
    }
  }

  const url = `${WEBAPP_URL}/?id=${userId}`;

  await ctx.reply(
    `🚀 Welcome ${name}!\n\nEarn money by watching ads 💰`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💰 Open AdzWallet", web_app: { url } }]
        ]
      }
    }
  );
});

/* ---------------- API ---------------- */

// user data
app.get('/user/:id', (req, res) => {
  const id = req.params.id;

  if (!users[id]) {
    users[id] = {
      balance: 0,
      referralCount: 0,
      referralEarnings: 0
    };
  }

  res.json(users[id]);
});

// ads reward
app.get('/api/reward', (req, res) => {
  const { userid, key } = req.query;

  if (key !== REWARD_SECRET) return res.send("INVALID");
  if (!userid) return res.send("NO_USER");

  if (!users[userid]) {
    users[userid] = {
      balance: 0,
      referralCount: 0,
      referralEarnings: 0
    };
  }

  users[userid].balance += 0.08;

  res.send("OK");
});

// withdraw
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, details } = req.body;

  if (!userId || !amount) {
    return res.json({ success: false, message: "Invalid request" });
  }

  const user = users[userId];
  if (!user) {
    return res.json({ success: false, message: "User not found" });
  }

  if (amount < 10) {
    return res.json({ success: false, message: "Minimum $10" });
  }

  if (amount > user.balance) {
    return res.json({ success: false, message: "Insufficient balance" });
  }

  user.balance -= amount;

  console.log("💸 Withdraw:", {
    userId,
    amount,
    method,
    details
  });

  res.json({ success: true });
});

/* ---------------- SERVER ---------------- */

app.listen(PORT, async () => {
  console.log(`✅ Server running on ${PORT}`);

  try {
    await bot.telegram.deleteWebhook();
    await bot.launch();
    console.log("🤖 Bot running");
  } catch (e) {
    console.log("Bot error:", e);
  }
});

/* ---------------- STOP ---------------- */

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
