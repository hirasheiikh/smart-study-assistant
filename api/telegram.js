const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTH_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GH_REPO || 'your-username/smart-study-assistant';
const WEB_URL = process.env.APP_URL || 'https://your-planner.vercel.app';

function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
}

function getMadridDate(offsetDays = 0) {
  const madridToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  if (!offsetDays) return madridToday;
  const d = new Date(madridToday + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
  });
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
  });
}

async function getGitHubFile() {
  const url = `https://api.github.com/repos/${REPO}/contents/index.html`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SmartStudyBot'
    }
  });
  if (!res.ok) throw new Error(`GitHub get failed: ${res.status}`);
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf8');
}

function getState(content) {
  const stateMatch = content.match(/<script id="state"[^>]*>(.*?)<\/script>/s);
  if (stateMatch) {
    try {
      return JSON.parse(stateMatch[1]);
    } catch (e) {}
  }
  return { done: [] };
}

function stripTaskHtml(raw) {
  return decodeEntities(
    (raw || '')
      .replace(/<span class="cal-sync"[^>]*>.*?<\/span>/gi, '')
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();
}

function extractRowFields(rowBody, fallbackLabel) {
  const ulMatch = rowBody.match(/<ul class="tasks">(.*?)<\/ul>/s);
  if (!ulMatch) return null;
  const dayColMatch = rowBody.match(/<td[^>]*class="day-col"[^>]*>(.*?)<\/td>/s) || rowBody.match(/<td[^>]*>(.*?)<\/td>/s);
  const label = dayColMatch ? dayColMatch[1].replace(/<[^>]+>/g, '').trim() : fallbackLabel;
  return { label, tasksHtml: ulMatch[1] };
}

function getTasksForDay(html, doneSet, isoDate) {
  const rowRegex = new RegExp(`<tr[^>]*data-day="${isoDate}"[^>]*>(.*?)<\\/tr>`, 's');
  const match = html.match(rowRegex);
  if (!match) return { label: isoDate, lines: [] };

  const parsed = extractRowFields(match[1], isoDate);
  if (!parsed) return { label: isoDate, lines: [] };
  const { label, tasksHtml } = parsed;
  const lines = [];
  const liRegex = /<li([^>]*)>(.*?)<\/li>/gs;
  let li;
  while ((li = liRegex.exec(tasksHtml)) !== null) {
    const attrs = li[1] || '';
    if (attrs.includes('movedaway')) continue;
    const text = stripTaskHtml(li[2]);
    if (!text) continue;
    const isNote = attrs.includes('note');
    if (isNote) {
      lines.push(`  ℹ️ _${text}_`);
      continue;
    }
    const idMatch = attrs.match(/data-id="([^"]+)"/);
    const id = idMatch ? idMatch[1] : '';
    const mark = (id && doneSet.has(id)) ? '✅' : '▫️';
    lines.push(`${mark} ${text}`);
  }
  return { label, lines };
}

function getOverdueAndTodayPending(html, doneSet, todayStr) {
  const rowRegex = /<tr[^>]*data-day="(\d{4}-\d{2}-\d{2})"[^>]*>(.*?)<\/tr>/gs;
  const sections = [];
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const day = m[1];
    if (day > todayStr) continue;
    const parsed = extractRowFields(m[2], day);
    if (!parsed) continue;
    const { label, tasksHtml } = parsed;
    const pending = [];
    const liRegex = /<li([^>]*)>(.*?)<\/li>/gs;
    let li;
    while ((li = liRegex.exec(tasksHtml)) !== null) {
      const attrs = li[1] || '';
      if (attrs.includes('movedaway') || attrs.includes('note')) continue;
      const idMatch = attrs.match(/data-id="([^"]+)"/);
      const id = idMatch ? idMatch[1] : '';
      if (!id || doneSet.has(id)) continue;
      const text = stripTaskHtml(li[2]);
      if (text) pending.push(`▫️ ${text}`);
    }
    if (pending.length > 0) {
      const heading = day === todayStr ? `📌 *Avui (${label}):*` : `⚠️ *${label} (${day}):*`;
      sections.push(`${heading}\n${pending.join('\n')}`);
    }
  }
  return sections;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Smart Study Bot actiu (Notificacions & Consultes ràpides)' });
  }

  // 1. Callback query
  if (req.body && req.body.callback_query) {
    const cb = req.body.callback_query;
    const chatId = cb.message ? String(cb.message.chat.id) : '';
    if (AUTH_CHAT_ID && chatId !== String(AUTH_CHAT_ID)) {
      await answerCallbackQuery(cb.id, 'No autoritzat');
      return res.status(200).send('Unauthorized');
    }
    await answerCallbackQuery(cb.id, 'Obre el planner web');
    await sendTelegram(
      chatId,
      `ℹ️ Ara tota l'edició del planning es fa des de l'assistent web (molt més ràpid i estable):\n${WEB_URL}`
    );
    return res.status(200).send('OK');
  }

  // 2. Missatges de l'usuari
  const { message } = req.body || {};
  if (!message || !message.chat) {
    return res.status(200).send('OK');
  }

  const chatId = String(message.chat.id);
  if (AUTH_CHAT_ID && chatId !== String(AUTH_CHAT_ID)) {
    await sendTelegram(chatId, '⚠️ Aquest és un bot privat de planificació.');
    return res.status(200).send('Unauthorized');
  }

  const rawText = (message.text || '').trim().toLowerCase();

  if (rawText === '/start' || rawText === '/help' || rawText === 'ajuda') {
    await sendTelegram(
      chatId,
      `📅 *Smart Study Bot*\n\nT'envio automàticament el resum del dia al matí i la revisió a la nit.\n\n⚡ *Consultes ràpides aquí:*\n• \`/avui\` → veure tasques d'avui\n• \`/dema\` → veure tasques de demà\n• \`/pendents\` → veure tot el pendent fins avui\n\n✨ *Per afegir, moure o parlar amb la IA*, fes servir l'assistent del planner web:\n${WEB_URL}`
    );
    return res.status(200).send('OK');
  }

  const isTodayCmd = rawText === '/avui' || rawText === 'avui';
  const isTomorrowCmd = rawText === '/dema' || rawText === 'dema' || rawText === 'demà' || rawText === '/demà';
  const isPendingCmd = rawText === '/pendents' || rawText === 'pendents' || rawText === 'pendent';

  if (isTodayCmd || isTomorrowCmd || isPendingCmd) {
    try {
      const html = await getGitHubFile();
      const state = getState(html);
      const doneSet = new Set(Array.isArray(state.done) ? state.done : []);
      const todayStr = getMadridDate(0);

      if (isTodayCmd || isTomorrowCmd) {
        const targetDate = isTodayCmd ? todayStr : getMadridDate(1);
        const { label, lines } = getTasksForDay(html, doneSet, targetDate);
        const header = isTodayCmd ? `📅 *Avui · ${label} (${targetDate}):*` : `📅 *Demà · ${label} (${targetDate}):*`;
        const body = lines.length > 0 ? lines.join('\n') : '_No hi ha tasques programades._';
        await sendTelegram(chatId, `${header}\n\n${body}\n\n🌐 ${WEB_URL}`);
        return res.status(200).send('OK');
      }

      const sections = getOverdueAndTodayPending(html, doneSet, todayStr);
      const body = sections.length > 0
        ? sections.join('\n\n')
        : '🎉 *Tot fet! No tens cap tasca pendent fins avui.*';
      await sendTelegram(chatId, `⏳ *Tasques pendents fins avui:*\n\n${body}\n\n🌐 ${WEB_URL}`);
      return res.status(200).send('OK');
    } catch (err) {
      console.error('Telegram command error:', err);
      await sendTelegram(chatId, '⚠️ No he pogut consultar el planning ara mateix. Prova-ho en uns segons.');
      return res.status(200).send('Error');
    }
  }

  await sendTelegram(
    chatId,
    `👋 Aquest bot de Telegram ara s'encarrega només dels avisos del matí/nit i consultes ràpides (/avui, /dema, /pendents).\n\n✨ Per afegir, moure o reorganitzar tasques, fes servir l'assistent del planner web (ara molt més ràpid):\n${WEB_URL}`
  );
  return res.status(200).send('OK');
};
