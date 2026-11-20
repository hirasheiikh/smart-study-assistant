const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GH_REPO || 'your-username/smart-study-assistant';
const WEB_URL = process.env.APP_URL || 'https://your-planner.vercel.app';

function getMadridDate() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: text, parse_mode: 'Markdown' })
  });
}

async function getGitHubFile() {
  const url = `https://api.github.com/repos/${REPO}/contents/index.html`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SmartStudyCron'
    }
  });
  if (!res.ok) throw new Error(`GitHub get failed: ${res.status}`);
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf8');
}

module.exports = async (req, res) => {
  const mode = req.query.mode || 'morning';

  try {
    const content = await getGitHubFile();

    let doneSet = new Set();
    const stateMatch = content.match(/<script id="state"[^>]*>(.*?)<\/script>/s);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        (state.done || []).forEach(d => doneSet.add(d));
      } catch (e) {}
    }

    const todayStr = getMadridDate();
    const todayDt = new Date(todayStr + 'T12:00:00Z');
    const yestDt = new Date(todayDt.getTime() - 86400000);
    const yestStr = yestDt.toISOString().slice(0, 10);

    const rowRegex = /<tr[^>]*data-day="([^"]+)"[^>]*>(.*?)<\/tr>/gs;
    let m;
    let todayTasks = [];
    let todayDone = [];
    let todayPending = [];
    let todayNotes = [];
    let todayLabel = todayStr;
    let yestPending = [];

    while ((m = rowRegex.exec(content)) !== null) {
      const day = m[1];
      const rowBody = m[2];
      const ulMatch = rowBody.match(/<ul class="tasks">(.*?)<\/ul>/s);
      if (!ulMatch) continue;
      const dayColMatch = rowBody.match(/<td[^>]*class="day-col"[^>]*>(.*?)<\/td>/s) || rowBody.match(/<td[^>]*>(.*?)<\/td>/s);
      const label = dayColMatch ? dayColMatch[1].replace(/<[^>]+>/g, '').trim() : day;
      const tasksHtml = ulMatch[1];

      const liRegex = /<li([^>]*)>(.*?)<\/li>/gs;
      let li;
      while ((li = liRegex.exec(tasksHtml)) !== null) {
        const attrs = li[1];
        const inner = decodeEntities(
          li[2]
            .replace(/<span class="cal-sync"[^>]*>.*?<\/span>/gi, '')
            .replace(/<[^>]+>/g, '')
        ).replace(/\s+/g, ' ').trim();
        const idMatch = attrs.match(/data-id="([^"]+)"/);
        const id = idMatch ? idMatch[1] : '';
        const isNote = attrs.includes('note');
        const isMovedAway = attrs.includes('movedaway');

        if (day === todayStr) {
          todayLabel = label;
          if (isNote) {
            todayTasks.push('  ℹ️ _' + inner + '_');
            todayNotes.push('  ℹ️ _' + inner + '_');
          } else if (!isMovedAway && id) {
            if (doneSet.has(id)) {
              todayTasks.push('✅ ' + inner);
              todayDone.push('✅ ' + inner);
            } else {
              todayTasks.push('▫️ ' + inner);
              todayPending.push('▫️ ' + inner);
            }
          }
        }

        if (day === yestStr) {
          if (!isNote && !isMovedAway && id && !doneSet.has(id)) {
            yestPending.push('⚠️ ' + inner);
          }
        }
      }
    }

    if (mode === 'morning') {
      const lines = [];
      lines.push(`📅 *Pla d'estudi: ${todayLabel} (${todayStr})*`);
      lines.push('');
      if (yestPending.length > 0) {
        lines.push('⏳ *Pendent d\'ahir:*');
        lines.push(...yestPending);
        lines.push('');
      }
      lines.push('📋 *Tasques d\'avui:*');
      if (todayTasks.length > 0) {
        lines.push(...todayTasks);
      } else {
        lines.push('_No hi ha tasques programades per avui._');
      }
      lines.push('');
      lines.push(`🌐 *Obre el planner:* ${WEB_URL}`);
      await sendTelegram(lines.join('\n'));
      return res.status(200).send('Morning notification sent');
    } else {
      const lines = [];
      const totalToday = todayDone.length + todayPending.length;
      lines.push(`🌙 *Resum del dia · ${todayLabel} (${todayStr})*`);
      lines.push('');
      lines.push(`📊 *Progrés:* ${todayDone.length} de ${totalToday} tasques completades`);
      lines.push('');
      lines.push('✅ *Fet avui:*');
      if (todayDone.length > 0) {
        lines.push(...todayDone);
      } else {
        lines.push('_Cap tasca marcada com a feta encara._');
      }
      lines.push('');
      lines.push('⏳ *Pendent d\'avui:*');
      if (todayPending.length > 0) {
        lines.push(...todayPending);
      } else {
        lines.push('🎉 *Tot completat avui! Bona feina!*');
      }
      if (todayNotes.length > 0) {
        lines.push('');
        lines.push(...todayNotes);
      }
      lines.push('');
      lines.push('✨ *Obre el planner per marcar tasques o reorganitzar amb l\'assistent:*');
      lines.push(WEB_URL);
      await sendTelegram(lines.join('\n'));
      return res.status(200).send('Evening notification sent');
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error: ' + err.message);
  }
};
