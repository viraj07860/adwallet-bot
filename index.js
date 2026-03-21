require('dotenv').config();

const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8080;

// ===== DATABASE =====
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

// ===== START =====
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  let user = await User.findOne({ userId });

  if (!user) {
    user = new User({ userId });
    await user.save();
  }

  ctx.reply(`🚀 Welcome!\n💰 Your Balance: ₹${user.balance}`);
});

// ===== CHECK BALANCE =====
bot.command('balance', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });
  ctx.reply(`💰 Balance: ₹${user.balance}`);
});

// ===== EARN SYSTEM (TEST) =====
bot.command('earn', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });

  user.balance += 10; // ₹10 per task (test)
  await user.save();

  ctx.reply(`✅ You earned ₹10!\n💰 New Balance: ₹${user.balance}`);
});

// ===== WITHDRAW SYSTEM =====
bot.command('withdraw', async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });

  if (user.balance < 50) {
    return ctx.reply("❌ Minimum withdrawal is ₹50");
  }

  ctx.reply(`💸 Withdrawal request sent!\nAmount: ₹${user.balance}`);

  user.balance = 0;
  await user.save();
});

// ===== WEBSITE =====
app.get('/', (req, res) => {
  res.send('🔥 AdWallet System Running');
});

// ===== USERS API =====
app.get('/users', async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// ===== START =====
app.listen(PORT, '0.0.0.0', () => {
  console.log("Server running on port " + PORT);
});

bot.launch();
