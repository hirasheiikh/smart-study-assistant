const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTH_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '6437779106';
const GH_TOKEN = process.env.GH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const REPO = 'hirasheiikh/planning-finals';

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
  clean = clean.replace(/^(afegeix|afegir|apunta|apuntar|posa|posar|anota|anotar|recorda(?:'m)?|he de|cal)\s*[:,-]?\s*/i, '');
  clean = clean.replace(/\s+(demà|dema|avui|avui a la nit|passat demà|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)$/i, '');
  clean = clean.trim();
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return clean;
}

function resolveTargetDate(text) {
  const low = (text || '').toLowerCase();
  const todayStr = getMadridDate(0);
  const tomorrowStr = getMadridDate(1);

  const numMatch = low.match(/\b(\d{1,2})[\/\.-](\d{1,2})\b/);
  if (numMatch) {
    const d = numMatch[1].padStart(2, '0');
    const m = numMatch[2].padStart(2, '0');
    return { date: `2026-${m}-${d}`, label: `${d}/${m}` };
  }

  const dayMatch = low.match(/\b(?:dia|el)\s+(\d{1,2})\b/);
  if (dayMatch) {
    const d = dayMatch[1].padStart(2, '0');
    return { date: `2026-11-${d}`, label: `${d}/11` };
  }

  if (low.includes('passat demà') || low.includes('dema passat') || low.includes('demà passat')) {
    return { date: getMadridDate(2), label: 'demà passat' };
  }
  if (low.includes('demà') || low.includes('dema')) {
    return { date: tomorrowStr, label: 'demà' };
  }
  if (low.includes('dijous') || low.includes('dj')) return { date: '2026-11-19', label: 'Dj 19' };
  if (low.includes('divendres') || low.includes('dv')) return { date: '2026-11-20', label: 'Dv 20' };
  if (low.includes('dissabte') || low.includes('ds') || low.includes('finde')) return { date: '2026-11-21', label: 'Ds 21' };
  if (low.includes('diumenge') || low.includes('dg')) return { date: '2026-11-22', label: 'Dg 22' };
  if (low.includes('dilluns') || low.includes('dl')) return { date: '2026-11-23', label: 'Dl 23' };
  if (low.includes('dimarts') || low.includes('dt')) return { date: '2026-11-24', label: 'Dt 24' };
  if (low.includes('dimecres') || low.includes('dc')) return { date: '2026-11-25', label: 'Dc 25' };
  return { date: todayStr, label: 'avui' };
}

// Telegram API Helpers
async function sendTelegram(chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
  });
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
  const body = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// GitHub API Helpers
async function getGitHubFile() {
  const url = `https://api.github.com/repos/${REPO}/contents/index.html`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'PlanningBot'
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
      'User-Agent': 'PlanningBot'
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

function parseTasksForDate(content, dateStr) {
  const state = getState(content);
  const doneSet = new Set(Array.isArray(state.done) ? state.done : []);

  const rowRegex = new RegExp(`<tr[^>]*data-day="${dateStr}"[^>]*>(.*?)</tr>`, 's');
  const rowMatch = content.match(rowRegex);
  if (!rowMatch) return [];

  const taskRegex = /<li\s+data-id="([^"]+)"([^>]*)>(.*?)<\/li>/gs;
  const tasks = [];
  let m;
  while ((m = taskRegex.exec(rowMatch[1])) !== null) {
    const id = m[1];
    const attrs = m[2] || '';
    const rawInner = m[3];
    const isDone = doneSet.has(id);
    const isMoved = attrs.includes('movedaway');
    const cleanText = decodeEntities(rawInner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

    tasks.push({ id, text: cleanText, done: isDone, moved: isMoved, raw: rawInner, attrs: attrs });
  }
  return tasks;
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

function getUpcomingScheduleOverview(content, fromDateStr, daysCount = 14) {
  const state = getState(content);
  const doneSet = new Set(Array.isArray(state.done) ? state.done : []);
  const allDays = [];
  const regex = /<tr[^>]*data-day="(\d{4}-\d{2}-\d{2})"[^>]*>(.*?)<\/tr>/gs;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const day = m[1];
    if (day < fromDateStr) continue;
    const inner = m[2];
    const taskRegex = /<li\s+data-id="([^"]+)"([^>]*)>(.*?)<\/li>/gs;
    const tasks = [];
    let tm;
    while ((tm = taskRegex.exec(inner)) !== null) {
      const id = tm[1];
      const attrs = tm[2] || '';
      const text = decodeEntities(tm[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      const isDone = doneSet.has(id);
      const isMoved = attrs.includes('movedaway');
      if (!isMoved) {
        tasks.push({ id, text, isDone, isWork: text.toLowerCase().includes('feina') || text.toLowerCase().includes('grifols') });
      }
    }
    allDays.push({ day, tasks, pendingCount: tasks.filter(t => !t.isDone).length, totalCount: tasks.length });
    if (allDays.length >= daysCount) break;
  }
  return allDays;
}

// 🧠 Execució atòmica d'accions sobre el contingut HTML
function executeActionBatch(initialContent, actions) {
  let updated = initialContent;
  const executionLog = [];

  for (const act of actions) {
    if (act.type === 'delete') {
      const q = (act.query || '').toLowerCase().trim();
      const all = parseAllTasks(updated);
      const matches = all.filter(t => {
        const textMatch = t.text.toLowerCase().includes(q) || (q.length > 3 && q.includes(t.text.toLowerCase().slice(0, 8)));
        if (!textMatch) return false;
        if (act.day) return t.day === act.day;
        return true;
      });

      for (const target of matches) {
        const liRegex = new RegExp(`\\s*<li[^>]*data-id="${target.id}"[^>]*>.*?</li>`, 's');
        if (updated.match(liRegex)) {
          updated = updated.replace(liRegex, '');
          executionLog.push(`🗑️ Eliminada (${target.day}): "${target.text}"`);
        }
      }
    } else if (act.type === 'add') {
      const day = act.day || getMadridDate(1);
      const clean = cleanTaskTitle(act.text);
      const isWork = Boolean(act.is_work);
      const newId = `${day}-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 100)}`;
      const formattedLi = isWork
        ? `<li data-id="${newId}">💼 <strong>Feina:</strong> ${clean}</li>`
        : `<li data-id="${newId}">${clean}</li>`;

      const rowRegex = new RegExp(`(<tr[^>]*data-day="${day}"[^>]*>.*?<ul class="tasks">)(.*?)(</ul>)`, 's');
      if (updated.match(rowRegex)) {
        updated = updated.replace(rowRegex, `$1$2${formattedLi}$3`);
        executionLog.push(`➕ Afegida (${day}): "${clean}"`);
      }
    } else if (act.type === 'move') {
      const q = (act.query || '').toLowerCase().trim();
      const targetDate = act.target_date || getMadridDate(1);
      const all = parseAllTasks(updated);
      const target = all.find(t => t.text.toLowerCase().includes(q) || (q.length > 3 && q.includes(t.text.toLowerCase().slice(0, 8))));

      if (target) {
        const liMatch = updated.match(new RegExp(`<li\\s+data-id="${target.id}"[^>]*>(.*?)</li>`, 's'));
        if (liMatch) {
          const rawInner = liMatch[1];
          updated = updated.replace(new RegExp(`\\s*<li\\s+data-id="${target.id}"[^>]*>.*?</li>`, 's'), '');
          const newId = `${targetDate}-${Date.now().toString().slice(-4)}`;
          const toRowRegex = new RegExp(`(<tr[^>]*data-day="${targetDate}"[^>]*>.*?<ul class="tasks">)(.*?)(</ul>)`, 's');
          if (updated.match(toRowRegex)) {
            updated = updated.replace(toRowRegex, `$1$2<li data-id="${newId}">${rawInner}</li>$3`);
            executionLog.push(`⏩ Moguda a ${targetDate}: "${target.text}"`);
          }
        }
      }
    } else if (act.type === 'edit') {
      const q = (act.query || '').toLowerCase().trim();
      const all = parseAllTasks(updated);
      const target = all.find(t => t.text.toLowerCase().includes(q) || (q.length > 3 && q.includes(t.text.toLowerCase().slice(0, 8))));

      if (target) {
        const liMatch = updated.match(new RegExp(`(<li\\s+data-id="${target.id}"[^>]*>)(.*?)(</li>)`, 's'));
        if (liMatch) {
          let formatted = act.text || target.raw;
          if (act.is_urgent && !formatted.includes('⚠️')) {
            formatted = `⚠️ <strong>${formatted.replace(/<\/?strong>/g, '').replace(/^⚠️\s*/, '')}</strong>`;
          } else if (act.is_bold && !formatted.includes('<strong>')) {
            formatted = `<strong>${formatted}</strong>`;
          }
          updated = updated.replace(new RegExp(`(<li\\s+data-id="${target.id}"[^>]*>)(.*?)(</li>)`, 's'), `$1${formatted}$3`);
          executionLog.push(`✏️ Modificada (${target.day}): "${target.text}" → "${formatted.replace(/<[^>]+>/g, '')}"`);
        }
      }
    }
  }

  return { updatedContent: updated, log: executionLog };
}

// 🧠 Motor Gemini amb suport per a accions múltiples i cascada de models
async function callGemini(userMessage, todayDate, todayTasks, upcomingSchedule) {
  if (!GEMINI_API_KEY) return null;

  const scheduleContext = Array.isArray(upcomingSchedule) ? upcomingSchedule.map(d => {
    const taskDetails = d.tasks.length > 0
      ? d.tasks.map(t => `${t.isDone ? '[FET] ' : ''}${t.text}`).join(' · ')
      : '(Cap tasca programada / lliure)';
    return `📅 ${d.day} [${d.pendingCount} pendents]: ${taskDetails}`;
  }).join('\n') : '';

  const systemPrompt = `Ets el secretari personal, confident i company d'estudi de la Hira Sheikh Ahmed (estudiant d'Enginyeria Informàtica a la UPC · FIB i QA/Validació de models d'IA a Grifols).
Tens la intel·ligència, calidesa, sentit comú i to humà del Gemini de debò. Parlaràs SEMPRE en CATALÀ.

Context de la Hira:
- Universitat: UPC · FIB (Enginyeria Informàtica). Assignatures claus: PAR, IDI, BD, ER, SIO.
- Feina: Grifols (QA/Models d'IA). Queries, reunions 15:30h, automacions.
- Filosofia: MAI modifiquis res sense demanar confirmació. Formula clarament el resum de les accions.

Data d'avui: ${todayDate}. Demà: ${getMadridDate(1)}.

Tasques d'avui (${todayDate}):
${todayTasks.length > 0 ? todayTasks.map(t => `- [${t.done ? 'X' : ' '}] ${t.text}`).join('\n') : '(Cap)'}

AGENDA I CÀRREGA DE FEINA DELS PROPERS 14 DIES:
${scheduleContext}

Instruccions de funcionament:
1. 💡 BUSCADOR DE FORATS I ASSESSOR D'HORARIS:
   Si la Hira pregunta coses com:
   - "Quan creus que hauria de fer X?"
   - "Quins dies tinc més forats per fer X o estudiar?"
   - "Quan em poses X tasca?"
   -> Analitza minuciosament la càrrega dels propers 14 dies (quants pendents té cada dia).
   -> Troba els dies amb menys tasques pendents o vespres més relaxats.
   -> Recomana-li amb claredat, empatia i precisió quins són els millors 2 o 3 moments, i proposa-li programar-la ("Vols que t'ho apunti per al dia X?").

2. ⚡ PROPOSTA D'ACCIONS (afegir, esborrar, moure, reprogramar, modificar/marcar urgent):
   REGISTRE D'ACCIONS OBLIGATORI:
   Si la Hira demana fer canvis (ex: "demà no quedaré per fer SIO sinó trucada a les 18:30", "esborra lo de quedar per fer sio tant dijous com divendres", "afegeix trucada a les 18:30", "posa en negreta l'entrega d'ER"):
   ÉS TOTALMENT PROHIBIT RETORNAR intent: "chat"!
   HAS DE RETORNAR SEMPRE EXCLUSIVAMENT:
   intent: "propose_actions"
   actions: array d'objectes concrets:
     - Per afegir: { "type": "add", "day": "YYYY-MM-DD", "text": "...", "is_work": false/true, "is_urgent": false/true }
     - Per esborrar: { "type": "delete", "day": "YYYY-MM-DD o null", "query": "paraules clau" }
     - Per moure: { "type": "move", "query": "...", "target_date": "YYYY-MM-DD" }
     - Per modificar/urgent: { "type": "edit", "query": "...", "text": "...", "is_urgent": true }
   summary: resum breu en una frase dels canvis proposats.
   reply: missatge clar demanant confirmació.
   El backend enviarà botons de confirmació interactius i guardarà l'acció per executar-la. SI RETORNES "chat", EL SISTEMA NO PODRÀ PROCESSAR ELS CANVIS!

3. Si demana la seva agenda ("què tinc demà?", "què tinc el 23/11?"):
   intent: "show_schedule", target_date: "YYYY-MM-DD".

4. Si és pura conversa informal, ànims o reflexions sense cap canvi de calendari ("hola caracola", "com estas", "estic cansada"):
   intent: "chat", reply: el teu missatge empàtic i encoratjador.

Retorna SEMPRE exclusivament el següent JSON vàlid:
{
  "intent": "propose_actions" | "show_schedule" | "chat",
  "actions": [ ... ],
  "summary": "Resum breu de les accions o null",
  "target_date": "YYYY-MM-DD o null",
  "reply": "Missatge per a la Hira en català"
}`;

  const models = ['gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-pro-latest'];

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }],
          system_instruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { response_mime_type: 'application/json' }
        })
      });
      if (res.ok) {
        const json = await res.json();
        const txt = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (txt) {
          return JSON.parse(txt);
        }
      }
    } catch (e) {
      console.warn(`Model ${model} failed, trying next:`, e.message);
    }
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Planning Bot Webhook actiu (Gemini Conversacional & Confirmació Interactiva)' });
  }

  // =========================================================================
  // 1. GESTIÓ DE BOTONS INTERACTIUS (CALLBACK QUERY)
  // =========================================================================
  if (req.body && req.body.callback_query) {
    const cb = req.body.callback_query;
    const cbId = cb.id;
    const chatId = String(cb.message.chat.id);
    const messageId = cb.message.message_id;
    const data = cb.data;
    const msgText = cb.message.text || '';

    if (chatId !== String(AUTH_CHAT_ID)) {
      await answerCallbackQuery(cbId, "No autoritzat");
      return res.status(200).send('Unauthorized');
    }

    try {
      // Cancel·lar acció pendent
      if (data === 'cancel' || data === 'cancel_pending') {
        const { content, sha } = await getGitHubFile();
        const state = getState(content);
        delete state.pending;
        const cleaned = updateState(content, state);
        await saveGitHubFile(cleaned, sha, "Planning Bot: cancel·lar acció pendent");
        await answerCallbackQuery(cbId, "Cancel·lat");
        await editTelegramMessage(chatId, messageId, "❌ D'acord, acció cancel·lada. No he tocat res al teu planning.");
        return res.status(200).send('OK');
      }

      // Confirmar accions múltiples / pendents
      if (data === 'confirm_pending') {
        const { content, sha } = await getGitHubFile();
        const state = getState(content);

        if (!state.pending || !Array.isArray(state.pending.actions) || state.pending.actions.length === 0) {
          await answerCallbackQuery(cbId, "No hi ha accions pendents");
          await editTelegramMessage(chatId, messageId, "⚠️ No he trobat cap canvi pendent per aplicar o ja s'havia processat.");
          return res.status(200).send('OK');
        }

        const { updatedContent, log } = executeActionBatch(content, state.pending.actions);
        const updatedState = getState(updatedContent);
        delete updatedState.pending;
        const finalHtml = updateState(updatedContent, updatedState);

        await saveGitHubFile(finalHtml, sha, `Planning Bot: aplicar canvis confirmats`);
        await answerCallbackQuery(cbId, "Canvis aplicats!");

        const logMsg = log.length > 0 ? `\n\n${log.join('\n')}` : '';
        await editTelegramMessage(chatId, messageId, `✅ **Perfecte, canvis confirmats i guardats al planning!**${logMsg}`);
        return res.status(200).send('OK');
      }

      // Legacy fallback: confirm_add
      if (data === 'confirm_add') {
        const dayMatch = msgText.match(/📅 Dia:\s*(\d{4}-\d{2}-\d{2})/);
        const workMatch = msgText.match(/💼 Feina:\s*(Sí|No)/i);
        const taskMatch = msgText.match(/📝 Tasca:\s*([^\n]+)/);

        if (!dayMatch || !taskMatch) {
          await answerCallbackQuery(cbId, "Error en les dades");
          await editTelegramMessage(chatId, messageId, "⚠️ No he pogut recuperar les dades de la tasca per afegir-la.");
          return res.status(200).send('OK');
        }

        const targetDate = dayMatch[1];
        const isWork = workMatch ? workMatch[1].toLowerCase() === 'sí' : false;
        const taskText = cleanTaskTitle(taskMatch[1]);
        const { content, sha } = await getGitHubFile();

        const { updatedContent } = executeActionBatch(content, [{ type: 'add', day: targetDate, text: taskText, is_work: isWork }]);
        const state = getState(updatedContent);
        delete state.pending;
        const finalHtml = updateState(updatedContent, state);

        await saveGitHubFile(finalHtml, sha, `Planning Bot: afegir tasca (${targetDate})`);
        await answerCallbackQuery(cbId, "Tasca afegida!");
        await editTelegramMessage(chatId, messageId, `✅ **Tasca confirmada i afegida al teu planning!**\n\n📅 *${targetDate}* · ${isWork ? '💼 Feina (Grifols)' : '🎓 Universitat'}\n📝 *${taskText}*`);
        return res.status(200).send('OK');
      }

      // Legacy fallback: confirm_del:id
      if (data.startsWith('confirm_del:')) {
        const taskId = data.slice(12);
        const { content, sha } = await getGitHubFile();
        const liRegex = new RegExp(`\\s*<li[^>]*data-id="${taskId}"[^>]*>.*?</li>`, 's');

        if (content.match(liRegex)) {
          let updated = content.replace(liRegex, '');
          const state = getState(updated);
          delete state.pending;
          const finalHtml = updateState(updated, state);

          await saveGitHubFile(finalHtml, sha, `Planning Bot: esborrar tasca ${taskId}`);
          await answerCallbackQuery(cbId, "Tasca esborrada!");
          await editTelegramMessage(chatId, messageId, "🗑️ **Tasca eliminada correctament del planning.**");
        } else {
          await answerCallbackQuery(cbId, "Tasca no trobada");
          await editTelegramMessage(chatId, messageId, "⚠️ Aquesta tasca ja no era al teu planning.");
        }
        return res.status(200).send('OK');
      }

    } catch (err) {
      console.error('Callback error:', err);
      await answerCallbackQuery(cbId, "Error processant acció");
      return res.status(200).send('Error');
    }
  }

  // =========================================================================
  // 2. GESTIÓ DE MISSATGES DE TEXT DE L'USUARI
  // =========================================================================
  const { message } = req.body || {};
  if (!message) {
    return res.status(200).send('OK');
  }

  const chatId = String(message.chat.id);
  if (chatId !== String(AUTH_CHAT_ID)) {
    await sendTelegram(chatId, "⚠️ Aquest és el bot privat de planificació de la Hira.");
    return res.status(200).send('Unauthorized');
  }

  if (message.voice) {
    await sendTelegram(chatId, "🎙️ He rebut la teva nota de veu, Hira! Pots fer servir el botó de dictat per veu del teu teclat mòbil i t'entendré a la perfecció.");
    return res.status(200).send('OK');
  }

  if (!message.text) {
    return res.status(200).send('OK');
  }

  const rawText = message.text.trim();
  const lower = rawText.toLowerCase();

  try {
    const todayStr = getMadridDate(0);
    const tomorrowStr = getMadridDate(1);
    const { content, sha } = await getGitHubFile();
    const state = getState(content);

    // 🎯 COMPROVACIÓ PRIORITÀRIA: SI L'USUARI DIU "SÍ" / "VAL" / "FES-HO" I HI HA UNA ACCIÓ PENDENT
    const isAffirmative = /^(s[ií]|val|d'?acord|fes[- ]?ho|endavant|confirmo|perfecte|ok|aplica[- ]?ho)$/i.test(lower);
    const isNegative = /^(no|cancela|cancel·la|deixa[- ]?ho)$/i.test(lower);

    if (state.pending && isAffirmative) {
      const actions = state.pending.actions || [];
      if (actions.length > 0) {
        const { updatedContent, log } = executeActionBatch(content, actions);
        const updatedState = getState(updatedContent);
        delete updatedState.pending;
        const finalHtml = updateState(updatedContent, updatedState);

        await saveGitHubFile(finalHtml, sha, "Planning Bot: aplicar canvis confirmats per text");
        const logMsg = log.length > 0 ? `\n\n${log.join('\n')}` : '';
        await sendTelegram(chatId, `✅ **Fet, Hira! He aplicat els canvis al teu planning:**${logMsg}`);
        return res.status(200).send('OK');
      }
    }

    if (!state.pending && isAffirmative) {
      await sendTelegram(chatId, "💡 No hi ha cap canvi pendent per confirmar en aquest moment, Hira! Els canvis anteriors (com la trucada de SIO a les 18:30h) ja estan registrats al teu planning. Si vols canviar o afegir alguna altra cosa, demana-m'ho directament!");
      return res.status(200).send('OK');
    }

    if (state.pending && isNegative) {
      delete state.pending;
      const finalHtml = updateState(content, state);
      await saveGitHubFile(finalHtml, sha, "Planning Bot: acció cancel·lada per text");
      await sendTelegram(chatId, "❌ D'acord, no he modificat res al teu planning.");
      return res.status(200).send('OK');
    }

    const todayTasks = parseTasksForDate(content, todayStr);
    const upcomingSchedule = getUpcomingScheduleOverview(content, todayStr, 14);

    // 🚀 Motor Conversacional Gemini (amb buscador de forats i accions múltiples)
    const nlu = await callGemini(rawText, todayStr, todayTasks, upcomingSchedule);

    if (nlu) {
      // 1. Proposta d'accions (afegir, esborrar, moure o batch)
      const actions = Array.isArray(nlu.actions) && nlu.actions.length > 0
        ? nlu.actions
        : (nlu.intent === 'propose_add' && (nlu.task_text || rawText)
            ? [{ type: 'add', day: nlu.target_date || resolveTargetDate(rawText).date, text: cleanTaskTitle(nlu.task_text || rawText), is_work: Boolean(nlu.is_work) }]
            : (nlu.intent === 'propose_delete' && (nlu.task_query || rawText)
                ? [{ type: 'delete', day: nlu.target_date, query: nlu.task_query || rawText }]
                : []));

      if (actions.length > 0 || nlu.intent === 'propose_actions') {
        const summary = nlu.summary || actions.map(a => `${a.type === 'delete' ? '🗑️ Esborrar' : a.type === 'add' ? '➕ Afegir' : '⏩ Moure'} (${a.day || 'dia'}): ${a.text || a.query}`).join('\n');

        // Guardem l'acció a l'estat per poder-la executar tant per botó com responent "sí"
        state.pending = { actions, summary, created_at: Date.now() };
        const updatedHtmlWithPending = updateState(content, state);
        await saveGitHubFile(updatedHtmlWithPending, sha, "Planning Bot: registrar acció pendent de confirmació");

        const promptText = `${nlu.reply || "He preparat els canvis. Em confirmes que vols que els apliqui?"}\n\n` +
                           `📋 *Resum dels canvis:*\n${summary}`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "✅ Sí, fes els canvis", callback_data: "confirm_pending" },
              { text: "❌ Cancel·la", callback_data: "cancel_pending" }
            ]
          ]
        };

        await sendTelegram(chatId, promptText, inlineKeyboard);
        return res.status(200).send('OK');
      }

      // 2. Mostrar agenda (lectura, no requereix confirmació)
      if (nlu.intent === 'show_schedule' || (!nlu.task_text && nlu.target_date && nlu.intent !== 'chat')) {
        const reqDate = nlu.target_date || todayStr;
        const tasks = parseTasksForDate(content, reqDate);
        if (tasks.length === 0) {
          await sendTelegram(chatId, `📅 No hi ha cap tasca programada per al dia *${reqDate}*.\n\n${nlu.reply || "Vols que n'apuntem alguna?"}`);
        } else {
          const list = tasks.map((t, i) => `${t.done ? '✅' : '▫️'} *${i + 1}.* ${t.text}`).join('\n\n');
          await sendTelegram(chatId, `📅 *Agenda de ${reqDate}:*\n\n${list}\n\n${nlu.reply || ''}`);
        }
        return res.status(200).send('OK');
      }

      // 3. Xat conversacional / consells / reflexions (com Gemini normal)
      if (nlu.reply) {
        await sendTelegram(chatId, nlu.reply);
        return res.status(200).send('OK');
      }
    }

    // --- Fallback amigable si cap model respon ---
    await sendTelegram(chatId, "Hola Hira! He tingut un petit tall de connexió. Em pots repetir què necessites? Soc aquí per ajudar-te amb qualsevol tasca o consulta de la teva agenda!");
    return res.status(200).send('OK');

  } catch (err) {
    console.error('Webhook error:', err);
    await sendTelegram(chatId, `⚠️ Error processant la petició: ${err.message}`);
    return res.status(200).send('Error');
  }
};
