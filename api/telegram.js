const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const REPO = process.env.GH_REPO || 'hirasheiikh/smart-study-assistant';

function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
}

function getMadridDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function cleanTaskTitle(text) {
  if (!text) return '';
  let clean = text.trim();
  clean = clean.replace(/^(afegeix|afegir|apunta|apuntar|posa|posar|anota|anotar|recorda(?:\s*\'?m)?|he de|cal)\s*[:,-]?\s*/i, '');
  clean = clean.replace(/\s+(demà|dema|avui|avui a la nit|passat demà|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)$/i, '');
  clean = clean.trim();
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return clean;
}

async function sendTelegram(chatId, text, replyMarkup = null) {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId || CHAT_ID,
    text: text,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
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
      'User-Agent': 'SmartStudyTelegramBot'
    }
  });
  if (!res.ok) throw new Error(`GitHub get failed: ${res.status}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { content, sha: data.sha };
}

async function saveGitHubFile(content, sha, message) {
  const url = `https://api.github.com/repos/${REPO}/contents/index.html`;
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SmartStudyTelegramBot'
    },
    body: JSON.stringify({ message: message, content: b64, sha: sha, branch: 'main' })
  });
  if (!res.ok) throw new Error(`GitHub save failed: ${res.status}`);
}

function getState(content) {
  const stateMatch = content.match(/<script id="state"[^>]*>(.*?)<\/script>/s);
  if (stateMatch) {
    try {
      return JSON.parse(stateMatch[1]);
    } catch (e) {}
  }
  return { done: [], t: Date.now() };
}

function updateState(content, newState) {
  newState.t = Date.now();
  const jsonStr = JSON.stringify(newState).replace(/</g, '\\u003c');
  return content.replace(/<script id="state"[^>]*>(.*?)<\/script>/s, `<script id="state" type="application/json">${jsonStr}</script>`);
}

function parseAllTasks(content) {
  const all = [];
  const rowRegex = /<tr[^>]*data-day="(\d{4}-\d{2}-\d{2})"[^>]*>(.*?)<\/tr>/gs;
  let rm;
  while ((rm = rowRegex.exec(content)) !== null) {
    const day = rm[1];
    const rowContent = rm[2];
    const taskRegex = /<li\s+data-id="([^"]+)"([^>]*)>(.*?)<\/li>/gs;
    let tm;
    while ((tm = taskRegex.exec(rowContent)) !== null) {
      const id = tm[1];
      const raw = tm[3];
      const text = decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      all.push({ day, id, text, raw });
    }
  }
  return all;
}

function getUpcomingScheduleOverview(content, fromDateStr, daysCount = 30) {
  const state = getState(content);
  const doneSet = new Set(Array.isArray(state.done) ? state.done : []);
  const allDays = [];
  const regex = /<tr[^>]*data-day="(\d{4}-\d{2}-\d{2})"[^>]*>.*?<td>(.*?)<\/td>.*?<td><ul class="tasks">(.*?)<\/ul><\/td>.*?<\/tr>/gs;
  let m;

  while ((m = regex.exec(content)) !== null) {
    const day = m[1];
    const dayLabel = m[2].replace(/<[^>]+>/g, '').trim();
    const tasksHtml = m[3];

    const tasks = [];
    const liRegex = /<li([^>]*)>(.*?)<\/li>/gs;
    let li;
    while ((li = liRegex.exec(tasksHtml)) !== null) {
      const attrs = li[1];
      const raw = li[2];
      const idMatch = attrs.match(/data-id="([^"]+)"/);
      const id = idMatch ? idMatch[1] : '';
      const isNote = attrs.includes('note');
      const isMovedAway = attrs.includes('movedaway');

      if (!isMovedAway && id) {
        const text = decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        const isDone = doneSet.has(id);
        const isWork = text.toLowerCase().includes('feina');
        tasks.push({ id, text, isDone, isWork, isNote });
      }
    }
    allDays.push({ day, dayLabel, tasks });
  }

  allDays.sort((a, b) => a.day.localeCompare(b.day));
  const filtered = allDays.filter(d => d.day >= fromDateStr).slice(0, daysCount);

  let out = '';
  filtered.forEach(d => {
    out += `📅 ${d.day} (${d.dayLabel}):\n`;
    if (d.tasks.length === 0) {
      out += '   - (Sense tasques)\n';
    } else {
      d.tasks.forEach(t => {
        const mark = t.isDone ? 'fet' : 'pendent';
        const workTag = t.isWork ? ' [feina]' : '';
        out += `   - [${mark}] ${t.text}${workTag}\n`;
      });
    }
  });
  return out;
}

function executeActionBatch(content, actions) {
  let updated = content;
  const log = [];
  const allTasks = parseAllTasks(content);

  for (const act of actions) {
    if (!act || !act.type) continue;

    if (act.type === 'add') {
      const day = act.day;
      const text = cleanTaskTitle(act.text);
      const isWork = Boolean(act.is_work);
      if (!day || !text) continue;

      const newId = `${day}-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
      const taskHtml = isWork
        ? `<li data-id="${newId}">💼 <strong>Feina:</strong> ${text}</li>`
        : `<li data-id="${newId}">${text}</li>`;

      const rowRegex = new RegExp(`(<tr[^>]*data-day="${day}"[^>]*>.*?<ul class="tasks">)(.*?)(</ul>)`, 's');
      if (updated.match(rowRegex)) {
        updated = updated.replace(rowRegex, `$1$2${taskHtml}$3`);
        log.push(`➕ Afegida a ${day}: "${text}"`);
      }
    }

    else if (act.type === 'move') {
      const query = (act.query || '').toLowerCase().trim();
      const targetDate = act.target_date;
      if (!query || !targetDate) continue;

      const target = allTasks.find(t => t.text.toLowerCase().includes(query) && t.day !== targetDate);
      if (target) {
        const liRegex = new RegExp(`\\s*<li[^>]*data-id="${target.id}"[^>]*>.*?</li>`, 's');
        updated = updated.replace(liRegex, '');

        const targetRowRegex = new RegExp(`(<tr[^>]*data-day="${targetDate}"[^>]*>.*?<ul class="tasks">)(.*?)(</ul>)`, 's');
        if (updated.match(targetRowRegex)) {
          const movedHtml = `<li data-id="${target.id}">${target.raw}</li>`;
          updated = updated.replace(targetRowRegex, `$1$2${movedHtml}$3`);
          log.push(`📦 Moguda de ${target.day} a ${targetDate}: "${target.text}"`);
        }
      }
    }

    else if (act.type === 'delete') {
      const query = (act.query || '').toLowerCase().trim();
      const day = act.day;
      if (!query) continue;

      const target = allTasks.find(t => {
        const matchText = t.text.toLowerCase().includes(query);
        return day ? (matchText && t.day === day) : matchText;
      });

      if (target) {
        const liRegex = new RegExp(`\\s*<li[^>]*data-id="${target.id}"[^>]*>.*?</li>`, 's');
        updated = updated.replace(liRegex, '');
        log.push(`🗑️ Eliminada de ${target.day}: "${target.text}"`);
      }
    }
  }

  return { updatedContent: updated, log };
}

async function callGeminiTelegram(userMessage, todayStr, upcomingSchedule) {
  if (!GEMINI_API_KEY) return null;

  const systemPrompt = `Ets el secretari d'estudi i assistent de productivitat personal a Telegram. Parles amb l'estudiant amb to natural, proper, engrescador i eficient.

DATA ACTUAL: Avui és ${todayStr} (hora de Madrid).

AGENDA EN DIRECTE:
${upcomingSchedule}

ACCIONS:
Pots proposar canvis:
- add: afegir -> { "type": "add", "day": "YYYY-MM-DD", "text": "...", "is_work": true|false }
- move: moure -> { "type": "move", "query": "text identificatiu", "target_date": "YYYY-MM-DD" }
- delete: esborrar -> { "type": "delete", "query": "text identificatiu", "day": "YYYY-MM-DD" }

FORMAT DE SORTIDA:
Respon SEMPRE amb un JSON:
{
  "reply": "Missatge explicatiu en català (o en la llengua de l'usuari)",
  "has_actions": true|false,
  "actions": [ ... ],
  "summary": "Resum breu dels canvis per al botó de confirmació"
}`;

  const models = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-flash-lite-latest', 'gemini-pro-latest'];

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          system_instruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (res.ok) {
        const json = await res.json();
        const txt = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (txt) return JSON.parse(txt);
      }
    } catch (e) {
      console.warn(`Telegram model ${model} failed:`, e.message);
    }
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot Webhook is live');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).send('No update');

    // Handle Callback Query (Buttons)
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data;
      const chatId = cb.message?.chat?.id;
      const messageId = cb.message?.message_id;

      if (data === 'cancel_change') {
        await answerCallbackQuery(cb.id, 'Cancel·lat');
        await editTelegramMessage(chatId, messageId, '❌ **Acció cancel·lada.** Cap canvi aplicat al teu planning.');
        return res.status(200).send('Cancelled');
      }

      if (data.startsWith('confirm_change:')) {
        await answerCallbackQuery(cb.id, 'Aplicant...');
        const changeId = data.replace('confirm_change:', '');

        const { content, sha } = await getGitHubFile();
        const state = getState(content);

        if (state.pending && state.pending.id === changeId) {
          const { updatedContent, log } = executeActionBatch(content, state.pending.actions);
          delete state.pending;
          const finalHtml = updateState(updatedContent, state);

          await saveGitHubFile(finalHtml, sha, 'Telegram Bot: aplicar canvis confirmats');
          const logMsg = log.length > 0 ? '\n\n' + log.join('\n') : '';
          await editTelegramMessage(chatId, messageId, `✅ **Canvis aplicats correctament al teu planning!**${logMsg}`);
        } else {
          await editTelegramMessage(chatId, messageId, '⚠️ Aquest canvi ja ha caducat o ja s\'havia aplicat anteriorment.');
        }
        return res.status(200).send('Confirmed');
      }
    }

    // Handle incoming text message
    const msg = update.message;
    if (!msg || !msg.text) return res.status(200).send('No message text');

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (String(chatId) !== String(CHAT_ID)) {
      await sendTelegram(chatId, "⚠️ Aquest és un bot privat d'assistència d'estudi.");
      return res.status(200).send('Unauthorized');
    }

    const todayStr = getMadridDate(0);
    const { content, sha } = await getGitHubFile();
    const upcomingSchedule = getUpcomingScheduleOverview(content, todayStr, 30);

    const result = await callGeminiTelegram(text, todayStr, upcomingSchedule);

    if (!result) {
      await sendTelegram(chatId, "Hola! He tingut un petit tall de connexió. Em pots repetir què necessites?");
      return res.status(200).send('Gemini error');
    }

    if (result.has_actions && result.actions && result.actions.length > 0) {
      const changeId = Date.now().toString(36);
      const state = getState(content);
      state.pending = { id: changeId, actions: result.actions, timestamp: Date.now() };
      const updatedWithPending = updateState(content, state);

      await saveGitHubFile(updatedWithPending, sha, 'Telegram: canvis pendents de confirmació');

      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Confirmar', callback_data: `confirm_change:${changeId}` },
            { text: '❌ Cancel·lar', callback_data: 'cancel_change' }
          ]
        ]
      };

      const msgText = `${result.reply}\n\n⚠️ *Vols que apliqui aquests canvis al teu planning?*\n${result.summary ? '_' + result.summary + '_' : ''}`;
      await sendTelegram(chatId, msgText, inlineKeyboard);
    } else {
      await sendTelegram(chatId, result.reply);
    }

    return res.status(200).send('Processed');

  } catch (err) {
    console.error('Telegram bot error:', err);
    return res.status(200).send('Error');
  }
};
