require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8080;

// ===== DATABASE =====
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected ✅"))
  .catch(err => console.log(err));

// ===== USER MODEL =====
const userSchema = new mongoose.Schema({
  userId: Number,
  balance: { type: Number, default: 0 },
});

const User = mongoose.model('User', userSchema);

// ===== BOT =====
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  const userId = ctx.from.id;

  let user = await User.findOne({ userId });

  if (!user) {
    user = new User({ userId });
    await user.save();
  }

  ctx.reply("🚀 Welcome to AdWallet!\n💰 Balance: ₹" + user.balance);
});

// ===== WEBSITE =====
app.get('/', (req, res) => {
  res.send("Dashboard running ✅");
});

// ===== ADMIN DASHBOARD API =====
app.get('/users', async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// ===== START =====
app.listen(PORT, '0.0.0.0', () => {
  console.log("Server running on port " + PORT);
});

bot.launch();
