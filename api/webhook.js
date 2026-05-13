import { Telegraf } from 'telegraf';
import { updateRailwayReplicas } from '../lib/railway.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// MIDDLEWARE: BẢO MẬT
bot.use(async (ctx, next) => {
  const allowedId = process.env.TELEGRAM_CHAT_ID;
  if (!allowedId || ctx.chat.id.toString() !== allowedId.toString()) {
    return ctx.reply("❌ Bạn không phải là chủ nhân của hệ thống này!");
  }
  return next();
});

// Lệnh /start
bot.start(async (ctx) => {
  await ctx.reply(
    "👋 Chào Chủ Nhân! Trợ lý Vietlott AI đã sẵn sàng.\n\n" +
    "🟢 /on - Bật Máy chủ (để vào Web/App)\n" +
    "🔴 /off - Tắt Máy chủ (tiết kiệm giờ)\n" +
    "🔄 /update - Ép cào dữ liệu mới ngay lập tức\n" +
    "⚡ /syncall - Đồng bộ toàn bộ lịch sử (2016-nay)\n" +
    "📊 /status - Kiểm tra tình trạng máy chủ\n" +
    "🔍 /kq <645|655> - Xem nhanh kết quả xổ số mới nhất\n" +
    "🔮 /dudoan <645|655> - Xin số dự đoán VIP"
  );
});

// Lệnh /status
bot.command('status', async (ctx) => {
  const domain = process.env.RAILWAY_DOMAIN || 'lucky-vietlot-production.up.railway.app';
  try {
    const start = Date.now();
    await axios.get(`https://${domain}`, { 
      timeout: 5000,
      validateStatus: (status) => status < 500 
    });
    const ping = Date.now() - start;
    await ctx.reply(`🟢 Máy chủ đang BẬT.\n📡 Ping: ${ping}ms\n🌐 Link: https://${domain}`);
  } catch (e) {
    await ctx.reply(`🔴 Máy chủ đang TẮT (hoặc đang khởi động).`);
  }
});

bot.command('syncall', async (ctx) => {
  const initialMessage = await ctx.reply('⚡ Đang chuẩn bị đồng bộ toàn bộ lịch sử... [0%]');
  const domain = process.env.RAILWAY_DOMAIN || 'lucky-vietlot-production.up.railway.app';
  const apiUrl = `https://${domain}/api/sync-all?chat_id=${ctx.chat.id}&message_id=${initialMessage.message_id}`;
  try {
    await axios.get(apiUrl, { timeout: 2000 });
  } catch (e) {
    // Timeout là cố ý để không chờ Railway xử lý xong (tránh lỗi 10s của Vercel)
  }
});

// Lệnh /kq
bot.command('kq', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const game = args[1];
  if (game !== '645' && game !== '655') {
    return ctx.reply("❌ Vui lòng nhập đúng cú pháp: /kq 645 hoặc /kq 655");
  }
  
  const endpoint = game === '645' ? 'winning-number-645' : 'winning-number-655';
  const gameName = game === '645' ? 'Mega 6/45' : 'Power 6/55';
  
  try {
    const url = `https://www.vietlott.vn/vi/trung-thuong/ket-qua-trung-thuong/${endpoint}`;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(res.data);
    
    let validOption = null;
    $('#drpSelectGameDraw option').each((i, el) => {
        if ($(el).attr('value') && !validOption) validOption = $(el);
    });
    
    if (!validOption) return ctx.reply("❌ Lỗi cấu trúc web Vietlott.");
    
    const text = validOption.text();
    const match = text.match(/(\d{2}\/\d{2}\/\d{4})\s*\((.+?)\)/);
    if (!match) return ctx.reply("❌ Không tìm thấy thông tin kỳ quay.");
    
    const dateStr = match[1];
    const drawId = match[2];
    
    const detailUrl = `https://www.vietlott.vn/vi/trung-thuong/ket-qua-trung-thuong/${game}?id=${drawId}&nocatche=1`;
    const detailRes = await axios.get(detailUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $d = cheerio.load(detailRes.data);
    
    const balls = [];
    $d('.day_so_ket_qua_v2 span').each((i, el) => balls.push($d(el).text().trim()));
    if (balls.length === 0) {
        $d('.day_so_ket_qua span').each((i, el) => balls.push($d(el).text().trim()));
    }
    
    if (balls.length > 0) {
      const mainBalls = game === '655' ? balls.slice(0, 6) : balls;
      const specialBall = game === '655' ? balls[6] : null;
      let msg = `🏆 <b>Kết quả ${gameName}</b>\nKỳ quay: #${drawId} ngày ${dateStr}\n`;
      msg += `Bóng: ${mainBalls.join(' - ')}\n`;
      if (specialBall) msg += `Đặc biệt: <b>${specialBall}</b>`;
      await ctx.reply(msg, { parse_mode: 'HTML' });
    } else {
      await ctx.reply("❌ Lỗi: Không đọc được bóng.");
    }
  } catch (e) {
    await ctx.reply(`❌ Lỗi kết nối: ${e.message}`);
  }
});

// Lệnh /dudoan
bot.command('dudoan', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const game = args[1];
  if (game !== '645' && game !== '655') {
    return ctx.reply("❌ Vui lòng nhập đúng cú pháp: /dudoan 645 hoặc /dudoan 655");
  }
  
  const domain = process.env.RAILWAY_DOMAIN || 'lucky-vietlot-production.up.railway.app';
  
  try {
    const msg = await ctx.reply("🔮 Đang phân tích thuật toán... (Yêu cầu Web phải BẬT)");
    const res = await axios.get(`https://${domain}/api/predict?game=${game}`, { timeout: 8000 });
    
    if (res.data.success) {
      const pred = res.data.prediction;
      const mainStr = pred.main.join(' - ');
      let text = `✨ <b>DỰ ĐOÁN AI - ${game === '645' ? 'MEGA 6/45' : 'POWER 6/55'}</b> ✨\n\n`;
      text += `🎱 Dãy số tiềm năng:\n<b>${mainStr}</b>\n`;
      if (pred.special) text += `🎯 Cầu vàng: <b>${pred.special}</b>\n`;
      text += `\n📈 Tỷ lệ tin cậy: ${Math.round(pred.confidence * 100)}%`;
      
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML' });
    } else {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, "❌ Lỗi khi dự đoán. Vui lòng thử lại.");
    }
  } catch (e) {
    await ctx.reply("❌ Máy chủ Web đang Tắt hoặc gặp lỗi. Vui lòng gõ /on trước rồi thử lại sau 30 giây.");
  }
});


// Lệnh /update
bot.command('update', async (ctx) => {
  try {
    // Gửi tin nhắn đầu tiên để báo là đang làm
    const initialMessage = await ctx.reply("🔄 Đang khởi động bộ cào dữ liệu... [0%]");
    
    // Báo sang Railway để chạy update và sửa tin nhắn
    const domain = process.env.RAILWAY_DOMAIN || 'lucky-vietlot-production.up.railway.app';
    const apiUrl = `https://${domain}/api/update?chat_id=${ctx.chat.id}&message_id=${initialMessage.message_id}`;
    
    // Sử dụng axios với timeout 1500ms để đảm bảo request ĐÃ ĐƯỢC GỬI ĐI
    // trước khi Vercel đóng băng function. 
    // Chúng ta catch lỗi timeout (hoàn toàn bình thường) để không crash bot.
    try {
      await axios.get(apiUrl, { timeout: 1500 });
    } catch (e) {
      // Bỏ qua lỗi timeout vì ta chỉ cần "kích hoạt" Railway rồi bỏ chạy, không cần chờ kết quả
    }
    
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
