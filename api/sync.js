const GH_TOKEN = process.env.GH_TOKEN;
const REPO = 'hirasheiikh/planning-finals';

function decodeEntities(str) {
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
      'User-Agent': 'PlanningWebSync'
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
      'User-Agent': 'PlanningWebSync'
    },
    body: JSON.stringify({ message: message, content: b64, sha: sha, branch: 'main' })
  });
  if (!res.ok) throw new Error(`GitHub save failed: ${res.status}`);
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

      const fixStyle = `<style id="drawerOverlayFix">
body:has(#assistantDrawerOverlay) .btn-assistant-toggle,
body:has(#assistantDrawerOverlay) .btn-scroll-top,
body:has(.assistant-drawer-overlay) .btn-assistant-toggle,
body:has(.assistant-drawer-overlay) .btn-scroll-top,
body:has(.task-modal-overlay) .btn-assistant-toggle,
body:has(.index-modal-overlay) .btn-assistant-toggle,
body.drawer-open .btn-assistant-toggle,
body.drawer-open .btn-scroll-top {
  display: none !important;
}
.assistant-drawer-overlay { z-index: 10000 !important; }
.assistant-drawer-card { z-index: 10001 !important; }
.btn-assistant-toggle { z-index: 990 !important; }
.btn-scroll-top { z-index: 980 !important; }
#bar button#bLogout, #bLogout {
  background: #fff1f2 !important;
  color: #e11d48 !important;
  border: 1px solid #fecdd3 !important;
  border-radius: 9999px !important;
  padding: 5px 12px !important;
  font-size: 11.5px !important;
  font-weight: 600 !important;
}
</style>`;
      if (!tplHtml.includes('id="drawerOverlayFix"')) {
        tplHtml = fixStyle + '\n' + tplHtml;
      }

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

    // 1. Toggle Checkbox / Mark Done
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

    // 2. Add New Task
    if (action === 'add_task') {
      const { day, text, isWork, taskId } = payload;
      if (!day || !text) return res.status(400).json({ error: 'Missing day or text' });

      const newId = taskId || `${day}-${Date.now().toString().slice(-4)}`;
      let cleanText = text.trim();
      cleanText = cleanText.replace(/^(afegeix|afegir|apunta|apuntar|posa|posar|anota|anotar)\s*[:,-]?\s*/i, '').trim();
      if (cleanText.length > 0) cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);

      let taskHtml = '';
      if (isWork && !cleanText.includes('Feina:')) {
        taskHtml = `<li data-id="${newId}">💼 <strong>Feina:</strong> ${cleanText}</li>`;
      } else {
        taskHtml = `<li data-id="${newId}">${cleanText}</li>`;
      }

      const rowRegex = new RegExp(`(<tr[^>]*data-day="${day}"[^>]*>.*?<ul class="tasks">)(.*?)(</ul>)`, 's');
      if (updated.match(rowRegex)) {
        updated = updated.replace(rowRegex, `$1$2${taskHtml}$3`);
        await saveGitHubFile(updated, sha, `Web sync: Add task on ${day}`);
        return res.status(200).json({ ok: true, id: newId, day: day });
      } else {
        return res.status(404).json({ error: 'Day not found in schedule' });
      }
    }

    // 3. Edit Task Content
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

    // 4. Delete Task
    if (action === 'delete_task') {
      const { taskId } = payload;
      if (!taskId) return res.status(400).json({ error: 'Missing taskId' });

      const liRegex = new RegExp(`\\s*<li[^>]*data-id="${taskId}"[^>]*>.*?</li>`, 's');
      if (updated.match(liRegex)) {
        updated = updated.replace(liRegex, '');
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
