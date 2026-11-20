const GH_TOKEN = process.env.GH_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const REPO = process.env.GH_REPO || 'your-username/smart-study-assistant';

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

function getMadridDateDetails() {
  const now = new Date();
  const timeZone = 'Europe/Madrid';

  const nowDateTime = new Intl.DateTimeFormat('ca-ES', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'medium'
  }).format(now);

  const weekdayName = new Intl.DateTimeFormat('ca-ES', {
    timeZone,
    weekday: 'long'
  }).format(now);

  const todayDate = getMadridDate(0);
  const tomorrowStr = getMadridDate(1);
  const dayAfterTomorrowStr = getMadridDate(2);

  return {
    nowDateTime,
    weekdayName,
    todayDate,
    tomorrowStr,
    dayAfterTomorrowStr
  };
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

async function getGitHubFile() {
  const url = `https://api.github.com/repos/${REPO}/contents/index.html`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SmartStudyAssistant'
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
      'User-Agent': 'SmartStudyAssistant'
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

function stripTaskHtml(raw) {
  if (!raw) return '';
  return decodeEntities(
    raw
      .replace(/<span class="cal-sync"[^>]*>.*?<\/span>/gi, '')
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();
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
      const text = stripTaskHtml(raw);
      all.push({ day, id, text, raw });
    }
  }
  return all;
}

function extractRowFields(rowBody, fallbackLabel) {
  const ulMatch = rowBody.match(/<ul class="tasks">(.*?)<\/ul>/s);
  if (!ulMatch) return null;
  const dayColMatch = rowBody.match(/<td[^>]*class="day-col"[^>]*>(.*?)<\/td>/s) || rowBody.match(/<td[^>]*>(.*?)<\/td>/s);
  const dayLabel = dayColMatch ? dayColMatch[1].replace(/<[^>]+>/g, '').trim() : fallbackLabel;
  return { dayLabel, tasksHtml: ulMatch[1] };
}

function getUpcomingScheduleOverview(content, fromDateStr, daysCount = 30) {
  const state = getState(content);
  const doneSet = new Set(Array.isArray(state.done) ? state.done : []);
  const allDays = [];
  const regex = /<tr[^>]*data-day="(\d{4}-\d{2}-\d{2})"[^>]*>(.*?)<\/tr>/gs;
  let m;

  while ((m = regex.exec(content)) !== null) {
    const day = m[1];
    const parsed = extractRowFields(m[2], day);
    if (!parsed) continue;
    const { dayLabel, tasksHtml } = parsed;

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
        const text = stripTaskHtml(raw);
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

function getOverdueTasks(content, todayDateStr) {
  const state = getState(content);
  const doneSet = new Set(Array.isArray(state.done) ? state.done : []);
  const overdue = [];
  const regex = /<tr[^>]*data-day="(\d{4}-\d{2}-\d{2})"[^>]*>(.*?)<\/tr>/gs;
  let m;

  while ((m = regex.exec(content)) !== null) {
    const day = m[1];
    if (day >= todayDateStr) continue;

    const parsed = extractRowFields(m[2], day);
    if (!parsed) continue;
    const { dayLabel, tasksHtml } = parsed;
    const liRegex = /<li([^>]*)>(.*?)<\/li>/gs;
    let li;
    while ((li = liRegex.exec(tasksHtml)) !== null) {
      const attrs = li[1];
      const raw = li[2];
      const idMatch = attrs.match(/data-id="([^"]+)"/);
      const id = idMatch ? idMatch[1] : '';
      const isMovedAway = attrs.includes('movedaway');

      if (!isMovedAway && id && !doneSet.has(id)) {
        const text = stripTaskHtml(raw);
        overdue.push(`- ${day} (${dayLabel}): "${text}" (id: ${id})`);
      }
    }
  }

  if (overdue.length === 0) return '(Cap tasca pendent de dies passats)';
  return overdue.slice(0, 25).join('\n');
}

function executeActionBatch(content, actions) {
  let updated = content;
  const log = [];

  for (const act of actions) {
    if (!act || !act.type) continue;

    if (act.type === 'add' || act.type === 'add_task') {
      const day = act.day;
      const text = cleanTaskTitle(act.text);
      const isWork = Boolean(act.is_work);
      if (!day || !text) continue;

      const newId = `${day}-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
      const taskHtml = isWork
        ? `<li data-id="${newId}">💼 <strong>Feina:</strong> ${text}<span class="cal-sync" style="display:none">⚠️</span></li>`
        : `<li data-id="${newId}">${text}<span class="cal-sync" style="display:none">⚠️</span></li>`;

      const rowRegex = new RegExp(`(<tr[^>]*data-day="${day}"[^>]*>.*?<ul class="tasks">)(.*?)(</ul>)`, 's');
      if (updated.match(rowRegex)) {
        updated = updated.replace(rowRegex, `$1$2${taskHtml}$3`);
        log.push(`➕ Afegida a ${day}: "${text}"`);
      }
    }

    else if (act.type === 'move' || act.type === 'move_task') {
      const query = (act.query || act.text || '').toLowerCase().trim();
      const targetDate = act.target_date || act.toDay;
      if (!query || !targetDate) continue;

      const allTasks = parseAllTasks(updated);
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

    else if (act.type === 'delete' || act.type === 'delete_task') {
      const query = (act.query || act.text || '').toLowerCase().trim();
      const day = act.day;
      if (!query) continue;

      const allTasks = parseAllTasks(updated);
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

    else if (act.type === 'edit' || act.type === 'edit_task') {
      const query = (act.query || act.text || '').toLowerCase().trim();
      if (!query) continue;

      const allTasks = parseAllTasks(updated);
      const target = allTasks.find(t => t.text.toLowerCase().includes(query));
      if (target) {
        let formatted = act.newText || act.text || target.raw;
        if (act.is_urgent && !formatted.includes('⚠️')) {
          formatted = `⚠️ <strong>${formatted.replace(/<\/?strong>/g, '').replace(/^⚠️\s*/, '')}</strong>`;
        } else if (act.is_bold && !formatted.includes('<strong>')) {
          formatted = `<strong>${formatted}</strong>`;
        }
        if (!formatted.includes('cal-sync')) {
          formatted += '<span class="cal-sync" style="display:none">⚠️</span>';
        }
        const liRegex = new RegExp(`(<li\\s+data-id="${target.id}"[^>]*>)(.*?)(</li>)`, 's');
        if (updated.match(liRegex)) {
          updated = updated.replace(liRegex, `$1${formatted}$3`);
          log.push(`✏️ Modificada (${target.day}): "${target.text}"`);
        }
      }
    }
  }

  return { updatedContent: updated, log };
}

function safeParseGeminiJson(txt) {
  if (!txt) return null;
  let clean = txt.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch (err) {
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {}
    }
    const replyMatch = clean.match(/"reply"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"has_actions|"\s*\})/);
    if (replyMatch) {
      return {
        reply: replyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        has_actions: false,
        actions: []
      };
    }
    return { reply: clean, has_actions: false, actions: [] };
  }
}

async function callGeminiAssistant(userMessage, conversationHistory, temporalContext, scheduleContext, overdueContext) {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY missing');
    return null;
  }

  const { nowDateTime, weekdayName, todayDate, tomorrowStr, dayAfterTomorrowStr } = temporalContext;

  const systemPrompt = `Ets l'assistent personal d'estudi i productivitat integrat a aquesta app de planificació intel·ligent. Parles amb l'estudiant com ho faria un bon assistent d'IA: amb conversa lliure, natural i sense límit de temes. Pots parlar de qualsevol cosa: dubtes de teoria, explicacions d'exercicis, com organitzar-se, concentració, motivació, idees de projectes o simplement xerrar. La gestió del planning és una de les coses que saps fer, no l'única.

PERSONALITAT I TO
- Càlid, proper, encoratjador i directe, com un/a bon/a company/a d'estudi molt ben organitzat/da. Res de to de robot ni de formulari.
- Respon amb naturalitat i empatia. Si l'usuari t'escriu en una altra llengua (català, castellà, anglès...), en to col·loquial, amb faltes, abreviatures o a mitges, l'entens igual i et comuniques de manera fluida en la mateixa llengua o per defecte en català.
- Adapta la llargada: a una pregunta ràpida, respon curt. A una explicació de teoria o a un pla, amb tot el detall que calgui. No posis llistes ni títols quan una frase n'hi ha prou.
- Sigues honest: si no saps una cosa o no la trobes a l'agenda, digues-ho. No t'inventis mai tasques, dates ni continguts que no siguin reals.
- Recorda el que s'ha dit abans en aquesta conversa i fes-ho servir (p. ex. si l'usuari diu que avui està cansat/da o té un examen demà, tingues-ho en compte quan proposis plans).

QUI ÉS L'USUARI
- Un/a estudiant (o professional en formació contínua) que utilitza aquest planning per organitzar assignatures, lliuraments de pràctiques, exàmens, projectes i tasques personals o laborals.
- Pots adaptar-te al seu ritme d'estudi i ajudar-lo a conciliar estudis, entregues i descans.

CONTEXT TEMPORAL (calculat per l'app; és la ÚNICA font de veritat per a les dates)
- Ara: ${nowDateTime} (${weekdayName})
- Avui: ${todayDate} · Demà: ${tomorrowStr} · Demà passat: ${dayAfterTomorrowStr}
- Interpreta les expressions relatives a partir d'aquí: "dissabte", "aquest cap de setmana", "la setmana que ve", "d'aquí a 3 dies", "després de l'examen", "abans de l'entrega"... Si una expressió és ambigua, tria la interpretació més lògica i explica quina data has entès.

PLANNING COMPLET (injectat en viu)
${scheduleContext}
Format: cada dia comença amb una línia "📅 YYYY-MM-DD" i a sota hi ha les seves tasques, amb l'estat (fet o pendent) i si són de feina.

TASQUES PENDENTS DE DIES PASSATS (calculat per l'app)
${overdueContext}

COM FAS SERVIR EL PLANNING
- Quan et pregunti per un dia, una setmana o una data, llegeix la línia "📅" corresponent i explica-li fidelment què hi té. No diguis mai que un dia està lliure si hi ha tasques.
- Quan et demani forats, càrrega o "quan puc fer X": analitza els dies (nombre de tasques pendents, feina, classes, entregues i exàmens propers) i proposa dies i franges concrets, amb el perquè.
- Quan et demani reorganitzar, endarrerir o "posar-se al dia": fes servir les tasques pendents de dies passats, proposa on encabir-les segons la càrrega real dels dies vinents i prioritza segons les dates d'examen i d'entrega.
- També pots fer servir el planning per iniciativa pròpia quan ajudi. Per exemple, si et diu "estic cansat/da", pots mirar què li queda avui i suggerir què es pot moure.
- Per a temes que no tenen res a veure amb el planning, respon normalment, sense forçar-lo a la conversa.

ACCIONS SOBRE EL PLANNING
Pots proposar canvis que l'app aplicarà quan l'usuari cliqui "Confirmar". Tipus:
- add: afegir una tasca -> { "type": "add", "day": "YYYY-MM-DD", "text": "...", "is_work": true|false }
- move: moure una tasca existent -> { "type": "move", "query": "text identificatiu de la tasca", "target_date": "YYYY-MM-DD" }
- delete: esborrar una tasca existent -> { "type": "delete", "query": "text identificatiu de la tasca", "day": "YYYY-MM-DD" }
- edit: modificar o destacar una tasca -> { "type": "edit", "query": "text identificatiu de la tasca", "newText": "nou text", "is_urgent": true|false, "is_bold": true|false }

Regles:
1. Només generes accions quan l'usuari demana un canvi, ja sigui explícitament ("mou-ho", "apunta'm", "treu això") o implícitament però clarament ("posa'm el metge dilluns", "això ja no cal que ho faci"). Si només pregunta o pensa en veu alta, proposa-ho en el text i pregunta si vol que ho apliquis.
2. Si dius que mous, afegeixes o esborres alguna cosa, l'acció HA D'APARÈIXER a "actions". Mai diguis "fet" o "ja ho he mogut": el canvi no es desa fins que confirma. Digues "t'ho deixo preparat, confirma-ho i queda desat".
3. Per a "move" i "delete", el "query" ha de ser un fragment literal i prou únic del text de la tasca tal com surt al planning.
4. "text" ha de ser net i concís.
5. Pots fer diverses accions alhora (p. ex. moure diverses tasques en una sola resposta).
6. Si falta informació imprescindible, pregunta-la en lloc d'endevinar.

FORMAT DE SORTIDA
Respon sempre amb un únic objecte JSON vàlid, sense text fora del JSON ni blocs \`\`\`:
{
  "reply": "La teva resposta en Markdown, tan llarga o curta com calgui.",
  "has_actions": true | false,
  "actions": [ ... ],
  "summary": "Una línia amb els canvis que s'aplicaran si confirma, o null si no n'hi ha"
}
Si no hi ha canvis: "has_actions": false, "actions": [], "summary": null.`;

  const contents = [];
  if (Array.isArray(conversationHistory)) {
    const sliced = conversationHistory.slice(-12);
    for (const h of sliced) {
      const role = (h.role === 'model' || h.role === 'assistant') ? 'model' : 'user';
      let text = typeof h.text === 'string' ? h.text : '';
      if (!text && h.parts && h.parts[0]) text = h.parts[0].text || '';

      if (role === 'model' && text.startsWith('{') && text.includes('"reply"')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.reply) text = parsed.reply;
        } catch (e) {}
      }

      const cleanText = text.trim();
      if (cleanText) {
        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts[0].text += '\n\n' + cleanText;
        } else {
          contents.push({ role, parts: [{ text: cleanText }] });
        }
      }
    }
  }

  const currentUserText = userMessage.trim();
  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    if (contents[contents.length - 1].parts[0].text !== currentUserText) {
      contents.push({ role: 'model', parts: [{ text: 'Entès.' }] });
      contents.push({ role: 'user', parts: [{ text: currentUserText }] });
    }
  } else {
    contents.push({ role: 'user', parts: [{ text: currentUserText }] });
  }

  while (contents.length > 0 && contents[0].role !== 'user') {
    contents.shift();
  }

  const modelCandidates = [
    { id: 'gemini-2.5-flash', disableThinking: true, timeoutMs: 10000 },
    { id: 'gemini-2.5-flash-lite', disableThinking: true, timeoutMs: 8000 },
    { id: 'gemini-flash-lite-latest', disableThinking: false, timeoutMs: 8000 },
    { id: 'gemini-flash-latest', disableThinking: false, timeoutMs: 10000 }
  ];

  const errors = [];
  for (const candidate of modelCandidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), candidate.timeoutMs);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidate.id}:generateContent?key=${GEMINI_API_KEY}`;
      const generationConfig = {
        responseMimeType: 'application/json',
        temperature: 0.4,
        maxOutputTokens: 1024
      };
      if (candidate.disableThinking) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig
        })
      });

      if (res.ok) {
        const json = await res.json();
        const txt = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (txt) {
          const parsed = safeParseGeminiJson(txt);
          if (parsed) return parsed;
        }
      } else {
        const err = await res.text().catch(() => '');
        const msg = `${candidate.id} (HTTP ${res.status}): ${err.slice(0, 200)}`;
        errors.push(msg);
        console.warn(msg);
      }
    } catch (e) {
      const msg = `${candidate.id} (${e.name === 'AbortError' ? 'Timeout' : 'Exception'}): ${e.message}`;
      errors.push(msg);
      console.warn(msg);
    } finally {
      clearTimeout(timer);
    }
  }
  console.error('All Gemini models failed:', errors.join(' | '));
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

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ ok: false, error: 'Cal enviar un missatge.' });
    }

    const temporalContext = getMadridDateDetails();
    const { content } = await getGitHubFile();
    const upcomingSchedule = getUpcomingScheduleOverview(content, temporalContext.todayDate, 30);
    const overdueContext = getOverdueTasks(content, temporalContext.todayDate);

    const result = await callGeminiAssistant(message, history, temporalContext, upcomingSchedule, overdueContext);

    if (!result) {
      return res.status(200).json({
        ok: true,
        reply: "Hola! He tingut un petit problema momentani de connexió amb Gemini. Torna-m'ho a demanar i t'ho responc al moment!",
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
