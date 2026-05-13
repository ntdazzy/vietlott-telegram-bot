import { Telegraf } from 'telegraf';
import { updateRailwayReplicas } from '../lib/railway.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Lệnh /start
bot.start(async (ctx) => {
  await ctx.reply(
    "👋 Chào bạn! Mình là Bot điều khiển máy chủ Vietlott.\n\n" +
    "Gõ /on để BẬT Web 🟢\n" +
    "Gõ /off để TẮT Web 🔴\n" +
    "Gõ /update để Cập nhật kết quả ngay 🔄"
  );
});

// Lệnh /update
bot.command('update', async (ctx) => {
  try {
    // Gửi tin nhắn đầu tiên để báo là đang làm
    const initialMessage = await ctx.reply("🔄 Đang khởi động bộ cào dữ liệu... [0%]");
    
    // Báo sang Railway để chạy update và sửa tin nhắn
    const domain = process.env.RAILWAY_DOMAIN || 'lucky-vietlot-production.up.railway.app';
    const apiUrl = `https://${domain}/api/update?chat_id=${ctx.chat.id}&message_id=${initialMessage.message_id}`;
    
    // Gọi lửa xong bỏ chạy (không await để Vercel không bị timeout 10s)
    fetch(apiUrl).catch(e => console.error("Lỗi khi gọi Railway:", e));
    
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Lỗi khi ra lệnh update!");
  }
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
