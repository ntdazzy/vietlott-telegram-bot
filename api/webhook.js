import { Telegraf } from 'telegraf';
import axios from 'axios';
import { updateRailwayReplicas } from '../lib/railway.js';

// ============================================================================
// CONFIG
// ----------------------------------------------------------------------------
// CRITICAL FIX SUMMARY:
//  - All bot commands now call the Railway API (single source of truth)
//    instead of scraping vietlott.vn from Vercel (was always 403).
//  - Trigger timeouts increased + wake-retry loop. Cold start no longer
//    silently drops /update or /syncall.
//  - 535 game supported in /kq and /dudoan.
//  - /them (manual entry) command added per BOT_API.md.
//  - All long ops use fire-and-forget via background trigger function.
// ============================================================================

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const RAILWAY_DOMAIN = process.env.RAILWAY_DOMAIN || 'lucky-vietlot-production.up.railway.app';
const API_BASE = `https://${RAILWAY_DOMAIN}`;
const UPDATE_SECRET = process.env.UPDATE_SECRET;

const GAME_NAMES = {
    '645': 'Mega 6/45',
    '655': 'Power 6/55',
    '535': 'Lotto 5/35',
    'max3dpro': 'Max 3D Pro',
};
const ALLOWED_GAMES = Object.keys(GAME_NAMES);
const LOTTERY_GAMES = ['645', '655', '535']; // games that support prediction

// ============================================================================
// HELPERS
// ============================================================================

function reply(ctx, text, opts = {}) {
    return ctx.reply(text, { parse_mode: 'HTML', ...opts });
}

function asPlainError(e) {
    if (e.response?.data?.error) return e.response.data.error;
    if (e.code === 'ECONNABORTED') return 'Hết thời gian chờ';
    if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') return 'Không kết nối được Railway';
    return e.message || 'Lỗi không xác định';
}

/**
 * Fire a long-running API call without waiting for completion.
 * Returns true if the request was successfully accepted (or timed out
 * after being received), false if Railway never responded.
 *
 * Why: Vercel webhook has 10s timeout. Railway can be in cold-start
 * (15-30s). We need to "wake" Railway and verify the request was
 * received before returning to Telegram.
 */
async function triggerLongRunning(url, { wakeRetries = 3, wakeTimeoutMs = 8000, fireTimeoutMs = 3000 } = {}) {
    // Step 1: Wake Railway with a HEAD or short GET, retrying if cold-started
    let awake = false;
    for (let i = 0; i < wakeRetries; i++) {
        try {
            await axios.head(`${API_BASE}/api/db-status`, { timeout: wakeTimeoutMs });
            awake = true;
            break;
        } catch (e) {
            // If it's a 404 on HEAD, server is still UP — just doesn't support HEAD
            if (e.response && e.response.status < 500) { awake = true; break; }
            // Otherwise keep retrying; cold start may take up to 30s
        }
    }
    if (!awake) return { ok: false, reason: 'server-down' };

    // Step 2: Fire the real trigger. Short timeout because Railway responds
    // immediately and runs the work in background.
    try {
        await axios.get(url, { timeout: fireTimeoutMs });
        return { ok: true };
    } catch (e) {
        // Timeout AFTER server is awake = work has been triggered, response just lost
        if (e.code === 'ECONNABORTED') return { ok: true, note: 'timeout-after-trigger' };
        if (e.response && e.response.status >= 200 && e.response.status < 300) return { ok: true };
        return { ok: false, reason: asPlainError(e) };
    }
}

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

bot.use(async (ctx, next) => {
    const allowedId = process.env.TELEGRAM_CHAT_ID;
    if (!allowedId) {
        console.warn('[bot] TELEGRAM_CHAT_ID not set — refusing all messages');
        return ctx.reply('❌ Bot chưa được cấu hình. Liên hệ admin.');
    }
    if (!ctx.chat || ctx.chat.id.toString() !== allowedId.toString()) {
        console.warn(`[bot] Unauthorized chat: ${ctx.chat?.id}`);
        return ctx.reply('❌ Bạn không phải là chủ nhân của hệ thống này!');
    }
    return next();
});

// ============================================================================
// /start /help
// ============================================================================

bot.start(async (ctx) => {
    await reply(ctx,
        '👋 Chào Chủ Nhân! Trợ lý Vietlott AI đã sẵn sàng.\n\n' +
        'Gõ /help để xem danh sách lệnh.'
    );
});

bot.help(async (ctx) => {
    await reply(ctx,
        '📜 <b>DANH SÁCH LỆNH</b>\n\n' +
        '⚡ <b>Máy chủ:</b>\n' +
        '• /on - Bật server Railway\n' +
        '• /off - Tắt server Railway\n' +
        '• /status - Trạng thái server + ping\n\n' +
        '🔄 <b>Dữ liệu:</b>\n' +
        '• /update - Cập nhật kỳ mới hôm nay\n' +
        '• /syncall - Đồng bộ toàn bộ lịch sử (chỉ thêm, không xóa)\n' +
        '• /cancel - Hủy đồng bộ đang chạy\n' +
        '• /db - Thống kê DB\n\n' +
        '🔍 <b>Tra cứu & Dự đoán:</b>\n' +
        '• /kq &lt;645|655|535|max3dpro&gt; - Kết quả mới nhất\n' +
        '• /dudoan &lt;645|655|535&gt; - Gợi ý AI\n' +
        '• /them &lt;game&gt; &lt;kỳ&gt; &lt;ngày&gt; &lt;bóng&gt; [đb] - Thêm tay\n\n' +
        '   <i>VD: /them 645 1234 12/05/2026 01,02,03,04,05,06</i>'
    );
});

// ============================================================================
// /status — quick health check
// ============================================================================

bot.command('status', async (ctx) => {
    try {
        const start = Date.now();
        const res = await axios.get(API_BASE, {
            timeout: 8000,
            validateStatus: s => s < 500,
        });
        const ping = Date.now() - start;
        await reply(ctx,
            `🟢 Server ĐANG BẬT\n` +
            `📡 Ping: ${ping}ms (HTTP ${res.status})\n` +
            `🌐 ${API_BASE}`
        );
    } catch (e) {
        await reply(ctx,
            `🔴 Server đang TẮT hoặc khởi động.\n` +
            `Gõ /on để bật.\n` +
            `<i>${asPlainError(e)}</i>`
        );
    }
});

// ============================================================================
// /db — DB stats with proper cold-start handling
// ============================================================================

bot.command('db', async (ctx) => {
    const msg = await reply(ctx, '⏳ Đang truy vấn DB...');
    try {
        // Long timeout to absorb cold start
        const res = await axios.get(`${API_BASE}/api/db-status`, { timeout: 25000 });
        if (!res.data.success) {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
                `❌ ${res.data.error || 'Không lấy được dữ liệu'}`);
            return;
        }

        const { counts, total, sync } = res.data;
        let text = '📊 <b>THỐNG KÊ DATABASE</b>\n\n';
        for (const [name, count] of Object.entries(counts)) {
            text += `• ${name}: <b>${count}</b> kỳ\n`;
        }
        text += `\n📦 Tổng: <b>${total}</b> kỳ`;

        if (sync?.running) {
            const mins = Math.round(sync.durationMs / 1000 / 60 * 10) / 10;
            text += `\n\n⚡ Đang đồng bộ ${mins} phút${sync.cancelRequested ? ' (đang hủy)' : ''}`;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML' });
    } catch (e) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
            `❌ ${asPlainError(e)}\nThử /on rồi đợi 30s.`);
    }
});

// ============================================================================
// /kq — Latest result (FIXED: now uses Railway API, not vietlott.vn)
// ============================================================================

bot.command('kq', async (ctx) => {
    const game = ctx.message.text.split(/\s+/)[1];
    if (!ALLOWED_GAMES.includes(game)) {
        return reply(ctx, `❌ Cú pháp: /kq &lt;${ALLOWED_GAMES.join('|')}&gt;`);
    }

    const msg = await reply(ctx, `⏳ Đang lấy kết quả ${GAME_NAMES[game]}...`);
    try {
        const res = await axios.get(`${API_BASE}/api/results?game=${game}&limit=1`, { timeout: 25000 });
        if (!res.data.success) {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
                `❌ ${res.data.error || 'Không có kết quả'}`);
            return;
        }

        const r = res.data.results[0];
        let text = `🏆 <b>${res.data.game}</b>\nKỳ #${r.drawId} - ${r.date}\n`;

        if (game === 'max3dpro') {
            if (r.dacBiet) text += `🥇 ĐB: <b>${r.dacBiet}</b>\n`;
            if (r.nhat) text += `🥈 Nhất: ${r.nhat}\n`;
            if (r.nhi) text += `🥉 Nhì: ${r.nhi}\n`;
            if (r.ba) text += `🎖 Ba: ${r.ba}`;
        } else if (r.balls) {
            text += `Bóng: <code>${r.balls}</code>`;
            if (r.specialBall) text += `\nĐặc biệt: <b>${r.specialBall}</b>`;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML' });
    } catch (e) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
            `❌ ${asPlainError(e)}\nThử /on rồi đợi 30s.`);
    }
});

// ============================================================================
// /dudoan — AI prediction
// ============================================================================

bot.command('dudoan', async (ctx) => {
    const game = ctx.message.text.split(/\s+/)[1];
    if (!LOTTERY_GAMES.includes(game)) {
        return reply(ctx, `❌ Cú pháp: /dudoan &lt;${LOTTERY_GAMES.join('|')}&gt;`);
    }

    const msg = await reply(ctx, `🔮 Đang phân tích thuật toán cho ${GAME_NAMES[game]}...`);
    try {
        // Long timeout — prediction runs ensemble + backtest, can take 5-15s
        const res = await axios.get(`${API_BASE}/api/predict?game=${game}`, { timeout: 45000 });
        if (!res.data.success) {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
                `❌ ${res.data.error || 'Không dự đoán được'}`);
            return;
        }

        const pred = res.data.prediction;
        let text = `✨ <b>DỰ ĐOÁN AI - ${GAME_NAMES[game]}</b>\n\n`;
        text += `🎱 Bộ số: <b>${pred.main.join(' - ')}</b>\n`;
        if (pred.special) text += `🎯 Cầu vàng: <b>${pred.special}</b>\n`;
        text += `\n📈 Tin cậy: ${Math.round(pred.confidence * 100)}%`;
        if (pred.breakdown) {
            text += `\n📊 Σ=${pred.breakdown.sum} | C/L=${pred.breakdown.evens}/${pred.breakdown.odds} | Vùng=${pred.breakdown.decadeCount}`;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, text, { parse_mode: 'HTML' });
    } catch (e) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
            `❌ ${asPlainError(e)}\nThử /on rồi đợi 30s.`);
    }
});

// ============================================================================
// /update — Trigger latest-results scrape (long-running)
// ============================================================================

bot.command('update', async (ctx) => {
    const msg = await reply(ctx, '🔄 Đang đánh thức server & khởi động cập nhật...');
    const url = `${API_BASE}/api/update?chat_id=${ctx.chat.id}&message_id=${msg.message_id}`;

    const result = await triggerLongRunning(url, { wakeRetries: 4, wakeTimeoutMs: 10000, fireTimeoutMs: 4000 });

    if (!result.ok) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
            `❌ Không kích hoạt được update: ${result.reason}\nGõ /on và đợi 30s rồi thử lại.`);
    }
    // If ok, Railway will edit this message with progress
});

// ============================================================================
// /syncall — Full history sync (long-running)
// ============================================================================

bot.command('syncall', async (ctx) => {
    const full = /\bfull\b/i.test(ctx.message.text);
    const msg = await reply(ctx, '⚡ Đang đánh thức server & khởi động đồng bộ...');
    const url = `${API_BASE}/api/sync-all?chat_id=${ctx.chat.id}&message_id=${msg.message_id}${full ? '&full=1' : ''}`;

    const result = await triggerLongRunning(url, { wakeRetries: 4, wakeTimeoutMs: 10000, fireTimeoutMs: 4000 });

    if (!result.ok) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
            `❌ Không kích hoạt được sync: ${result.reason}\nGõ /on và đợi 30s rồi thử lại.`);
    }
});

// ============================================================================
// /cancel
// ============================================================================

bot.command('cancel', async (ctx) => {
    try {
        const res = await axios.get(`${API_BASE}/api/sync-cancel`, { timeout: 15000 });
        const m = res.data?.message || (res.data?.success ? 'Đã gửi tín hiệu hủy' : 'Không có gì để hủy');
        await reply(ctx, `🛑 ${m}`);
    } catch (e) {
        await reply(ctx, `❌ ${asPlainError(e)}`);
    }
});

// ============================================================================
// /them — Manual data entry (when 403 / scrape fails)
// Syntax: /them <game> <drawId> <date> <balls> [special_ball]
// ============================================================================

bot.command('them', async (ctx) => {
    if (!UPDATE_SECRET) {
        return reply(ctx, '❌ UPDATE_SECRET chưa cấu hình trong env của bot.');
    }

    const parts = ctx.message.text.split(/\s+/).slice(1);
    if (parts.length < 4) {
        return reply(ctx,
            '❌ Cú pháp: <code>/them &lt;game&gt; &lt;kỳ&gt; &lt;ngày&gt; &lt;bóng&gt; [đb]</code>\n' +
            'VD: <code>/them 645 1234 12/05/2026 01,02,03,04,05,06</code>'
        );
    }

    const [game, drawId, dateStr, ballsRaw, special_ball] = parts;
    if (!ALLOWED_GAMES.includes(game)) {
        return reply(ctx, `❌ Game không hợp lệ. Cho phép: ${ALLOWED_GAMES.join(', ')}`);
    }

    const balls = ballsRaw.split(',').map(b => b.trim().padStart(2, '0')).join(', ');

    try {
        const res = await axios.post(
            `${API_BASE}/api/update`,
            { game, drawId, dateStr, balls, special_ball, secret: UPDATE_SECRET },
            { timeout: 20000 }
        );
        if (res.data.success) {
            const verb = res.data.status === 'inserted' ? '✅ Đã thêm' : '✓ Đã có sẵn';
            await reply(ctx, `${verb} ${GAME_NAMES[game]} #${drawId}\nDB hiện có <b>${res.data.total}</b> kỳ.`);
        } else {
            await reply(ctx, `❌ ${res.data.error || 'Không thêm được'}`);
        }
    } catch (e) {
        await reply(ctx, `❌ ${asPlainError(e)}`);
    }
});

// ============================================================================
// /on /off — Railway scale control
// ============================================================================

bot.command('on', async (ctx) => {
    try {
        await reply(ctx, '⏳ Đang bật server Railway...');
        await updateRailwayReplicas(1);
        await reply(ctx, '✅ Server đã BẬT. Đợi 30-60s để boot xong.');
    } catch (e) {
        await reply(ctx, `❌ Lỗi bật server: ${asPlainError(e)}`);
    }
});

bot.command('off', async (ctx) => {
    try {
        await reply(ctx, '⏳ Đang tắt server Railway...');
        await updateRailwayReplicas(0);
        await reply(ctx, '🛑 Server đã TẮT.');
    } catch (e) {
        await reply(ctx, `❌ Lỗi tắt server: ${asPlainError(e)}`);
    }
});

// ============================================================================
// GLOBAL ERROR HANDLER
// ----------------------------------------------------------------------------
// Catches any unhandled error inside command handlers so the webhook
// returns 200 to Telegram — preventing infinite retries that cause
// duplicate command execution.
// ============================================================================

bot.catch((err, ctx) => {
    console.error(`[bot] Unhandled error on ${ctx.updateType}:`, err);
    try {
        ctx.reply(`❌ Lỗi nội bộ: ${err.message || 'unknown'}`);
    } catch {}
});

// ============================================================================
// VERCEL HANDLER
// ----------------------------------------------------------------------------
// Always return 200 to Telegram. Returning 500 causes Telegram to retry the
// update for hours, leading to duplicate command execution. We log errors
// instead.
// ============================================================================

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('Bot is running');
    }

    try {
        await bot.handleUpdate(req.body);
    } catch (e) {
        console.error('[webhook] handleUpdate threw:', e);
    }
    return res.status(200).send('OK');
}
