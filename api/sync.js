const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GH_REPO || 'hirasheiikh/smart-study-assistant';

function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
}

async function getGitHubFile() {
  const url = `https://api.github.com/repos/${REPO}/contents/index.html`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SmartStudySync'
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
      'User-Agent': 'SmartStudySync'
    },
    body: JSON.stringify({ message: message, content: b64, sha: sha, branch: 'main' })
  });
  if (!res.ok) throw new Error(`GitHub save failed: ${res.status}`);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { content, sha } = await getGitHubFile();
      const stateMatch = content.match(/<script id="state"[^>]*>(.*?)<\/script>/s);
      let state = { done: [], t: Date.now() };
      if (stateMatch) {
        try { state = JSON.parse(stateMatch[1]); } catch(e){}
      }
      const tplMatch = content.match(/<template id="content">(.*?)<\/template>/s);
      let tplHtml = tplMatch ? tplMatch[1] : '';

      return res.status(200).json({
        ok: true,
        state: state,
        templateHtml: tplHtml,
        sha: sha
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Sync API is live' });
  }

  try {
    const payload = req.body || {};
    const action = payload.action;

    const { content, sha } = await getGitHubFile();
    let updated = content;

    // Direct DOM / state update
    if (payload.templateHtml && payload.state) {
      const stateMatch = updated.match(/<script id="state"[^>]*>(.*?)<\/script>/s);
      const newState = JSON.stringify(payload.state).replace(/</g, '\\u003c');
      updated = updated.replace(/<script id="state"[^>]*>.*?<\/script>/s, `<script id="state" type="application/json">${newState}</script>`);

      const tplMatch = updated.match(/<template id="content">(.*?)<\/template>/s);
      if (tplMatch) {
        updated = updated.replace(/<template id="content">.*?<\/template>/s, `<template id="content">${payload.templateHtml}</template>`);
      }
      await saveGitHubFile(updated, sha, `Web sync: ${payload.action || 'sync tasks and state'}`);
      return res.status(200).json({ ok: true, state: payload.state });
    }

    // Toggle checkbox
    if (action === 'toggle_done') {
      const { taskId, done } = payload;
      const stateMatch = updated.match(/<script id="state"[^>]*>(.*?)<\/script>/s);
      if (stateMatch) {
        let state = JSON.parse(stateMatch[1]);
        let doneSet = new Set(state.done || []);
        if (done) doneSet.add(taskId);
        else doneSet.delete(taskId);
        const newState = JSON.stringify({ done: Array.from(doneSet), t: Date.now() });
        updated = updated.replace(/<script id="state"[^>]*>.*?<\/script>/s, `<script id="state" type="application/json">${newState}</script>`);
        await saveGitHubFile(updated, sha, `Web sync: Toggle ${taskId} (${done ? 'done' : 'undone'})`);
        return res.status(200).json({ ok: true, state: JSON.parse(newState) });
      }
    }

    // Add task
    if (action === 'add_task') {
      const { day, text, isWork, taskId } = payload;
      if (!day || !text) return res.status(400).json({ error: 'Missing day or text' });

      const newId = taskId || `${day}-${Date.now().toString().slice(-4)}`;
      let cleanText = text.trim();
      cleanText = cleanText.replace(/^(afegeix|afegir|apunta|apuntar|posa|posar|anota|anotar|add)\s*[:,-]?\s*/i, '').trim();
      if (cleanText.length > 0) cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

      let taskHtml = isWork
        ? `<li data-id="${newId}">💼 <strong>Feina:</strong> ${cleanText}</li>`
        : `<li data-id="${newId}">${cleanText}</li>`;

      const rowRegex = new RegExp(`(<tr[^>]*data-day="${day}"[^>]*>.*?<ul class="tasks">)(.*?)(</ul>)`, 's');
      if (updated.match(rowRegex)) {
        updated = updated.replace(rowRegex, `$1$2${taskHtml}$3`);
        await saveGitHubFile(updated, sha, `Web sync: Add task on ${day}`);
        return res.status(200).json({ ok: true, id: newId, day: day });
      } else {
        return res.status(404).json({ error: 'Day not found in schedule' });
      }
    }

    // Edit task
    if (action === 'edit_task') {
      const { taskId, newText } = payload;
      if (!taskId || !newText) return res.status(400).json({ error: 'Missing taskId or newText' });

      const liRegex = new RegExp(`(<li[^>]*data-id="${taskId}"[^>]*>)(.*?)(</li>)`, 's');
      if (updated.match(liRegex)) {
        updated = updated.replace(liRegex, `$1${newText}$3`);
        await saveGitHubFile(updated, sha, `Web sync: Edit task ${taskId}`);
        return res.status(200).json({ ok: true, id: taskId });
      } else {
        return res.status(404).json({ error: 'Task not found' });
      }
    }

    // Delete task
    if (action === 'delete_task') {
      const { taskId } = payload;
      if (!taskId) return res.status(400).json({ error: 'Missing taskId' });

      const liRegex = new RegExp(`\\s*<li[^>]*data-id="${taskId}"[^>]*>.*?</li>`, 's');
      if (updated.match(liRegex)) {
        updated = updated.replace(liRegex, '');

        const stateMatch = updated.match(/<script id="state"[^>]*>(.*?)<\/script>/s);
        if (stateMatch) {
          try {
            let state = JSON.parse(stateMatch[1]);
            if (Array.isArray(state.done) && state.done.includes(taskId)) {
              state.done = state.done.filter(id => id !== taskId);
              state.t = Date.now();
              const newState = JSON.stringify(state);
              updated = updated.replace(/<script id="state"[^>]*>.*?<\/script>/s, `<script id="state" type="application/json">${newState}</script>`);
            }
          } catch(e) {}
        }

        await saveGitHubFile(updated, sha, `Web sync: Delete task ${taskId}`);
        return res.status(200).json({ ok: true, id: taskId });
      } else {
        return res.status(404).json({ error: 'Task not found' });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Sync API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
