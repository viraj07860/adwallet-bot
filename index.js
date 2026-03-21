require('dotenv').config();

const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8080;

// ===== MONGODB =====
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected ✅"))
  .catch(err => console.log("MongoDB error ❌", err));

// ===== USER MODEL =====
const userSchema = new mongoose.Schema({
  userId: Number,
  balance: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);

// ===== BOT =====
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== START BUTTON (MINI APP) =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  let user = await User.findOne({ userId });

  if (!user) {
    user = new User({ userId });
    await user.save();
  }

  ctx.reply(
    `🚀 Welcome to AdWallet!\n💰 Balance: ₹${user.balance}`,
    {
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
    }
  );
});

// ===== BALANCE =====
bot.command('balance', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });
  ctx.reply(`💰 Balance: ₹${user?.balance || 0}`);
});

// ===== EARN (TEST) =====
bot.command('earn', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });

  if (!user) return ctx.reply("User not found");

  user.balance += 10;
  await user.save();

  ctx.reply(`✅ You earned ₹10\n💰 Balance: ₹${user.balance}`);
});

// ===== WITHDRAW =====
bot.command('withdraw', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });

  if (!user) return ctx.reply("User not found");

  if (user.balance < 50) {
    return ctx.reply("❌ Minimum withdrawal ₹50");
  }

  ctx.reply(`💸 Withdrawal requested: ₹${user.balance}`);

  user.balance = 0;
  await user.save();
});

// ===== CPA POSTBACK =====
app.get('/postback', async (req, res) => {
  const userId = req.query.user_id;
  const amount = 20;

  const user = await User.findOne({ userId });

  if (user) {
    user.balance += amount;
    await user.save();
  }

  res.send("OK");
});

// ===== STATIC MINI APP =====
app.use(express.static('public'));

// ===== HOME =====
app.get('/', (req, res) => {
  res.send("🔥 AdWallet Mini App Running");
});

// ===== USERS API =====
app.get('/users', async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// ===== START SERVER =====
app.listen(PORT, '0.0.0.0', () => {
  console.log("Server running on port " + PORT);
});

// ===== START BOT =====
bot.launch()
  .then(() => console.log("Bot started ✅"))
  .catch(err => console.log("Bot error ❌", err));
