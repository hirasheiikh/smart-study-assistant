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

async function getGitHubFile() {
  const url = `https://api.github.com/repos/${REPO}/contents/index.html`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'PlanningAssistant'
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
      'User-Agent': 'PlanningAssistant'
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

async function callGeminiAssistant(userMessage, conversationHistory, todayDate, upcomingSchedule) {
  if (!GEMINI_API_KEY) return null;

  const scheduleContext = upcomingSchedule.map(d => {
    const taskDetails = d.tasks.length > 0
      ? d.tasks.map(t => `${t.isDone ? '[FET] ' : ''}${t.text}`).join(' · ')
      : '(Cap tasca programada / dia completament lliure)';
    return `📅 ${d.day} [${d.pendingCount} pendents de ${d.totalCount}]: ${taskDetails}`;
  }).join('\n');

  const systemPrompt = `Ets l'Assistent Intel·ligent d'Estudi i Planificació de la Hira Sheikh Ahmed integrat directament a la seva aplicació web de finals.
Ets el Gemini de debò: càlid, perspicaç, empàtic, analític, estructurat i 100% en CATALÀ.

Perfil de la Hira:
- Estudiant d'Enginyeria Informàtica a la UPC · FIB (assignatures clau: PAR, IDI, BD, ER, SIO).
- QA & Validació de models d'IA a Grifols (reunions a les 15:30h, queries, automacions).
- Data d'avui: ${todayDate}.

AGENDA I CÀRREGA DE FEINA DELS PROPERS 14 DIES:
${scheduleContext}

LES TEVES CAPACITATS PRINCIPALS:
1. 💡 BUSCADOR DE FORATS I OPTIMITZADOR D'HORARIS:
   Quan la Hira pregunti coses com:
   - "Quan creus que hauria de fer X?"
   - "Quins dies tinc més forats per estudiar / fer tasques?"
   - "Quan em recomanes posar-me amb BD o PAR?"
   -> Analitza minuciosament la càrrega de cada dia: quants pendents té, quins dies tenen menys feina o estan lliures, quines entregues té properes.
   -> Dóna-li una resposta analítica i motivadora: assenyala els 2 o 3 millors dies concrets amb menys càrrega, explica per què és ideal i pregunta-li si vol que li programis.

2. ✍️ GESTIÓ DIRECTA DEL PLANNING (AFEGIR, ESBORRAR O MOURE TASQUES):
   Si la Hira demana fer canvis (o accepta una proposta):
   Retorna l'intent "propose_actions" amb l'array d'accions concretes.

Retorna SEMPRE exclusivament el següent JSON vàlid:
{
  "reply": "La teva resposta completa en català, amb format Markdown net (negretes, llistes, consells)",
  "has_actions": true o false,
  "actions": [
    { "type": "add" | "delete" | "move", "day": "YYYY-MM-DD", "text": "text net", "is_work": false | true, "query": "..." }
  ],
  "summary": "Resum curt dels canvis que es faran al planning si l'usuari clica confirmar (o null)"
}`;

  const contents = [];
  if (Array.isArray(conversationHistory)) {
    for (const h of conversationHistory.slice(-6)) {
      if (h.role && h.text) {
        contents.push({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text }]
        });
      }
    }
  }
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  const models = ['gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-pro-latest'];

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Assistent IA Web actiu (Gemini API & Schedule Optimizer)' });
  }

  try {
    const { action, actions, message, history } = req.body || {};

    // 1. Execució de canvis confirmats per l'usuari des del xat web
    if (action === 'execute_actions' && Array.isArray(actions) && actions.length > 0) {
      const { content, sha } = await getGitHubFile();
      const { updatedContent, log } = executeActionBatch(content, actions);
      const state = getState(updatedContent);
      delete state.pending;
      const finalHtml = updateState(updatedContent, state);

      await saveGitHubFile(finalHtml, sha, `Assistent Web: aplicar canvis confirmats`);
      return res.status(200).json({
        ok: true,
        message: 'Canvis aplicats correctament al planning.',
        log: log,
        state: state
      });
    }

    // 2. Consulta conversacional a l'agent Gemini
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ ok: false, error: 'Cal enviar un missatge.' });
    }

    const todayStr = getMadridDate(0);
    const { content } = await getGitHubFile();
    const upcomingSchedule = getUpcomingScheduleOverview(content, todayStr, 14);

    const result = await callGeminiAssistant(message, history, todayStr, upcomingSchedule);

    if (!result) {
      return res.status(200).json({
        ok: true,
        reply: "Hola Hira! He tingut un petit problema de comunicació amb el servei de Gemini. Em pots tornar a fer la pregunta?",
        has_actions: false,
        actions: []
      });
    }

    return res.status(200).json({
      ok: true,
      reply: result.reply,
      has_actions: Boolean(result.has_actions && result.actions && result.actions.length > 0),
      actions: result.actions || [],
      summary: result.summary || null
    });

  } catch (err) {
    console.error('Assistant error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
