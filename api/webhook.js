import { Telegraf } from 'telegraf';
import { updateRailwayReplicas } from '../lib/railway.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Lệnh /start
bot.start((ctx) => {
  ctx.reply(
    "👋 Chào bạn! Mình là Bot điều khiển máy chủ Vietlott.\n\n" +
    "Gõ /on để BẬT Web 🟢\n" +
    "Gõ /off để TẮT Web 🔴"
  );
});

// Lệnh /on
bot.command('on', async (ctx) => {
  try {
    await ctx.reply("⏳ Đang gửi lệnh BẬT server lên Railway...");
    await updateRailwayReplicas(1);
    await ctx.reply("✅ Server đã được BẬT! Vui lòng đợi khoảng 30s - 1 phút để web chạy lên nhé.");
  } catch (error) {
    await ctx.reply(`❌ Lỗi khi bật server: ${error.message}`);
  }
});

// Lệnh /off
bot.command('off', async (ctx) => {
  try {
    await ctx.reply("⏳ Đang gửi lệnh TẮT server lên Railway...");
    await updateRailwayReplicas(0);
    await ctx.reply("🛑 Server đã TẮT thành công! Ngưng tính giờ miễn phí.");
  } catch (error) {
    await ctx.reply(`❌ Lỗi khi tắt server: ${error.message}`);
  }
});

// Xuất ra API cho Vercel
export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Bot is running!');
    }
  } catch (e) {
    console.error(e);
    res.status(500).send('Error');
  }
}
