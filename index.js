require('dotenv').config();

const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8080;

// ===== CONFIG =====
const CHANNEL_USERNAME = "@AdWalletCommunity";
const APP_URL = "https://adwallet-bot-production.up.railway.app/";

// ===== DATABASE =====
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected ✅"))
  .catch(err => console.log("MongoDB error ❌", err));

// ===== MODEL =====
const userSchema = new mongoose.Schema({
  userId: Number,
  balance: { type: Number, default: 0 },
  referredBy: { type: Number, default: null }
});

const User = mongoose.model('User', userSchema);

// ===== BOT =====
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== CHECK JOIN =====
async function isUserJoined(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(
      CHANNEL_USERNAME,
      ctx.from.id
    );
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

// ===== START =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const refId = ctx.startPayload;

  let user = await User.findOne({ userId });

  if (!user) {
    user = new User({
      userId,
      referredBy: refId || null
    });
    await user.save();

    if (refId && refId != userId) {
      const refUser = await User.findOne({ userId: Number(refId) });
      if (refUser) {
        refUser.balance += 10;
        await refUser.save();
      }
    }
  }

  ctx.reply(
    `🚀 Welcome to AdWallet\n💰 Balance: ₹${user.balance}\n\n⚠️ Join channel to unlock earning`,
    {
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
              text: "💰 Open App",
              web_app: {
                url: APP_URL
              }
            }
          ]
        ]
      }
    }
  );
});

// ===== BALANCE =====
bot.command('balance', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });
  ctx.reply(`💰 Balance: ₹${user?.balance || 0}`);
});

// ===== EARN =====
bot.command('earn', async (ctx) => {

  const joined = await isUserJoined(ctx);

  if (!joined) {
    return ctx.reply(
      "❌ Join our channel to start earning",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📢 Join Channel",
                url: "https://t.me/AdWalletCommunity"
              }
            ]
          ]
        }
      }
    );
  }

  const user = await User.findOne({ userId: ctx.from.id });

  user.balance += 10;
  await user.save();

  ctx.reply(`✅ Earned ₹10\n💰 Balance: ₹${user.balance}`);
});

// ===== WITHDRAW =====
bot.command('withdraw', async (ctx) => {

  const joined = await isUserJoined(ctx);

  if (!joined) {
    return ctx.reply(
      "❌ Join channel to withdraw money",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📢 Join Channel",
                url: "https://t.me/AdWalletCommunity"
              }
            ]
          ]
        }
      }
    );
  }

  const user = await User.findOne({ userId: ctx.from.id });

  if (user.balance < 50) {
    return ctx.reply("❌ Minimum withdrawal ₹50");
  }

  ctx.reply(`💸 Withdrawal requested: ₹${user.balance}`);

  user.balance = 0;
  await user.save();
});

// ===== REFERRAL =====
bot.command('referral', (ctx) => {
  const userId = ctx.from.id;
  const link = `https://t.me/AdzwalletBot?start=${userId}`;

  ctx.reply(`👥 Your Referral Link:\n\n${link}\n\nEarn ₹10 per user 💰`);
});

// ===== USER API =====
app.get('/user/:id', async (req, res) => {
  const userId = Number(req.params.id);

  let user = await User.findOne({ userId });

  if (!user) {
    user = new User({ userId });
    await user.save();
  }

  res.json(user);
});

// ===== POSTBACK =====
app.get('/postback', async (req, res) => {
  const userId = req.query.user_id;

  const user = await User.findOne({ userId });

  if (user) {
    user.balance += 20;
    await user.save();
  }

  res.send("OK");
});

// ===== STATIC =====
app.use(express.static('public'));

// ===== SERVER =====
app.listen(PORT, '0.0.0.0', () => {
  console.log("Server running on port " + PORT);
});

// ===== BOT START =====
bot.launch()
  .then(() => console.log("Bot started ✅"))
  .catch(err => console.log("Bot error ❌", err));

// Start server first so Railway is happy
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is live on port ${PORT}`);
    
    // Now launch the bot
    bot.launch().then(() => console.log("Bot is live ✅"));
});
