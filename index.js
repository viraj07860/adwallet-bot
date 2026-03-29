require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REWARD_SECRET = process.env.REWARD_SECRET || 'adwallet7062';
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

if (!WEBAPP_URL) {
  console.error("❌ WEBAPP_URL missing");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/* ---------------- DATABASE (TEMP MEMORY) ---------------- */
const users = {};

/* ---------------- HELPER ---------------- */
function getWebAppUrl(userId) {
  return `${WEBAPP_URL}/?id=${encodeURIComponent(userId)}`;
}

/* ---------------- ROUTES ---------------- */

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get user data
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

// Reward after ad
app.get('/api/reward', (req, res) => {
  const { userid, key } = req.query;

  if (key !== REWARD_SECRET) {
    return res.status(403).send("INVALID_KEY");
  }

  if (!userid) return res.send("NO_USER");

  if (!users[userid]) {
    users[userid] = {
      balance: 0,
      referralCount: 0,
      referralEarnings: 0
    };
  }

  // basic anti-spam (5 sec cooldown)
  const now = Date.now();
  if (users[userid].lastReward && now - users[userid].lastReward < 5000) {
    return res.send("TOO_FAST");
  }

  users[userid].balance += 0.08;
  users[userid].lastReward = now;

  return res.send("OK");
});

// Withdraw
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, details } = req.body;

  if (!userId || !amount) {
    return res.json({ success: false, message: "Invalid request" });
  }

  if (!users[userId]) {
    return res.json({ success: false, message: "User not found" });
  }

  if (amount < 100) {
    return res.json({ success: false, message: "Minimum $100" });
  }

  if (amount > users[userId].balance) {
    return res.json({ success: false, message: "Insufficient balance" });
  }

  users[userId].balance -= amount;

  console.log("💸 Withdraw Request:", {
    userId,
    amount,
    method,
    details
  });

  return res.json({ success: true });
});

/* ---------------- TELEGRAM BOT ---------------- */

// START COMMAND (WITH REFERRAL SYSTEM)
bot.start(async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const refId = ctx.startPayload;
    const webAppUrl = getWebAppUrl(userId);

    if (!users[userId]) {
      users[userId] = {
        balance: 0,
        referralCount: 0,
        referralEarnings: 0
      };

      // 🎯 Referral logic
      if (refId && refId !== userId) {
        if (!users[refId]) {
          users[refId] = {
            balance: 0,
            referralCount: 0,
            referralEarnings: 0
          };
        }

        users[refId].referralCount += 1;
        users[refId].referralEarnings += 0.075;
        users[refId].balance += 0.075;

        console.log(`🎉 Referral: ${refId} invited ${userId}`);
      }
    }

    await ctx.reply(
      "🚀 Welcome to AdzWallet!\n\nStart earning by watching ads 💰",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "💰 Open AdzWallet",
                web_app: { url: webAppUrl }
              }
            ]
          ]
        }
      }
    );
  } catch (err) {
    console.error("Start Error:", err);
    ctx.reply("❌ Something went wrong.");
  }
});

/* ---------------- START SERVER ---------------- */

app.listen(PORT, async () => {
  console.log(`✅ Server running on ${PORT}`);

  try {
    await bot.telegram.deleteWebhook();

    await bot.launch({
      polling: true
    });

    console.log("🤖 Bot started successfully");
  } catch (err) {
    console.error("Bot launch error:", err);
  }
});

/* ---------------- STOP HANDLERS ---------------- */

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
