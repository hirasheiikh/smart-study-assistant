const GH_TOKEN = process.env.GH_TOKEN;
const REPO = 'hirasheiikh/planning-finals';

function decodeEntities(str) {
  return str.replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec))
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
}

async function getPlanningHtml() {
  const url = `https://api.github.com/repos/${REPO}/contents/index.html`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'PlanningCalendar'
    }
  });
  if (!res.ok) throw new Error(`GitHub get failed: ${res.status}`);
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf8');
}

function formatIcsDate(date, isAllDay = false) {
  const pad = n => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  if (isAllDay) return `${y}${m}${d}`;
  const h = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

function parseIcsEvents(html) {
  const events = [];

  // 1. Calendari clau
  const calClauMatch = html.match(/<h3 id="calendari-clau"[^>]*>.*?<\/h3>.*?<table>.*?<tbody>(.*?)<\/tbody>/s);
  if (calClauMatch) {
    const rowsHtml = calClauMatch[1];
    const rowRegex = /<tr[^>]*>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<\/tr>/gs;
    let m;
    while ((m = rowRegex.exec(rowsHtml)) !== null) {
      const dateRaw = decodeEntities(m[1].replace(/<[^>]+>/g, '').trim());
      const descRaw = decodeEntities(m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

      if (dateRaw.includes('?') || dateRaw.startsWith('Cada')) continue;

      let year = 2026;
      if (dateRaw.includes('/01') || dateRaw.includes('/02')) year = 2027;

      const dateMatch = dateRaw.match(/(\d{1,2})\/(\d{1,2})/);
      if (!dateMatch) continue;

      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10);

      // Check hours (e.g. 9–11 h, 15–18 h, 12:00)
      const hourRangeMatch = dateRaw.match(/(\d{1,2})[–-](\d{1,2})\s*h/);
      const exactHourMatch = dateRaw.match(/(\d{1,2}):(\d{2})/);

      if (hourRangeMatch) {
        const sh = parseInt(hourRangeMatch[1], 10);
        const eh = parseInt(hourRangeMatch[2], 10);
        // CET is UTC+1
        const start = new Date(Date.UTC(year, month - 1, day, sh - 1, 0, 0));
        const end = new Date(Date.UTC(year, month - 1, day, eh - 1, 0, 0));
        events.push({
          uid: `key-${year}-${month}-${day}-${sh}@planning-finals`,
          summary: descRaw.split('→')[0].split('⚠️')[0].trim(),
          description: descRaw,
          start,
          end,
          isAllDay: false
        });
      } else if (exactHourMatch) {
        const sh = parseInt(exactHourMatch[1], 10);
        const smin = parseInt(exactHourMatch[2], 10);
        const start = new Date(Date.UTC(year, month - 1, day, sh - 1, smin, 0));
        const end = new Date(Date.UTC(year, month - 1, day, sh, smin, 0));
        events.push({
          uid: `key-${year}-${month}-${day}-${sh}-${smin}@planning-finals`,
          summary: descRaw.split('→')[0].split('⚠️')[0].trim(),
          description: descRaw,
          start,
          end,
          isAllDay: false
        });
      } else {
        // All-day
        const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
        const end = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
        events.push({
          uid: `key-${year}-${month}-${day}-allday@planning-finals`,
          summary: descRaw.split('→')[0].trim(),
          description: descRaw,
          start,
          end,
          isAllDay: true
        });
      }
    }
  }

  // 2. Daily tasks (calls, deliveries, meetings, labs, timed events)
  const dayRowRegex = /<tr[^>]*data-day="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let dm;
  while ((dm = dayRowRegex.exec(html)) !== null) {
    const dayIso = dm[1]; // YYYY-MM-DD
    const rowHtml = dm[2];
    const parts = dayIso.split('-').map(Number);
    const [year, month, day] = parts;

    const tasksMatch = rowHtml.match(/<ul class="tasks">([\s\S]*?)<\/ul>/);
    if (!tasksMatch) continue;

    const liRegex = /<li([^>]*)>([\s\S]*?)<\/li>/gs;
    let li;
    while ((li = liRegex.exec(tasksMatch[1])) !== null) {
      const attrs = li[1];
      if (attrs.includes('movedaway')) continue;

      const inner = decodeEntities(li[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      if (!inner) continue;

      const idMatch = attrs.match(/data-id="([^"]+)"/);
      const taskId = idMatch ? idMatch[1] : `${dayIso}-${inner.slice(0, 15).replace(/[^a-zA-Z0-9]/g, '')}`;

      // 1. Check for exact time e.g. "a les 18:30h", "18:30h", "18:30", "14:00"
      const exactTimeMatch = inner.match(/(?:a\s+les\s+)?(\b\d{1,2})[:.](\d{2})\s*h?\b/i);
      // 2. Check for time ranges e.g. "8–10 lab", "16:30–17:30"
      const rangeTimeMatch = inner.match(/\b(\d{1,2})(?::(\d{2}))?[–-](\d{1,2})(?::(\d{2}))?\s*h?\b/);
      // 3. Check for single hour like "15 h:"
      const singleHourMatch = inner.match(/\b(\d{1,2})\s*h(?:\s*:|\s+informe|\b)/i);

      const isImportant = inner.includes('📞') || inner.includes('⚠️') || inner.includes('🚨') ||
                          /trucada|reuni[oó]|examen|entrega|parcial|revisi[oó]|deadline|lab\b|sio\b/i.test(inner);

      if (exactTimeMatch) {
        const sh = parseInt(exactTimeMatch[1], 10);
        const smin = parseInt(exactTimeMatch[2], 10);
        if (sh >= 6 && sh <= 23) {
          // CET is UTC+1
          const start = new Date(Date.UTC(year, month - 1, day, sh - 1, smin, 0));
          const end = new Date(Date.UTC(year, month - 1, day, sh - 1, smin + 45, 0));
          const uid = `task-${taskId}@planning-finals`;
          if (!events.some(e => e.uid === uid)) {
            events.push({
              uid,
              summary: inner,
              description: inner,
              start, end, isAllDay: false
            });
          }
          continue;
        }
      }

      if (rangeTimeMatch && !inner.toLowerCase().includes('pag.') && !inner.toLowerCase().includes('pàg.')) {
        const sh = parseInt(rangeTimeMatch[1], 10);
        const smin = rangeTimeMatch[2] ? parseInt(rangeTimeMatch[2], 10) : 0;
        const eh = parseInt(rangeTimeMatch[3], 10);
        const emin = rangeTimeMatch[4] ? parseInt(rangeTimeMatch[4], 10) : 0;
        if (sh >= 6 && eh <= 23 && eh >= sh) {
          const start = new Date(Date.UTC(year, month - 1, day, sh - 1, smin, 0));
          const end = new Date(Date.UTC(year, month - 1, day, eh - 1, emin, 0));
          const uid = `task-${taskId}@planning-finals`;
          if (!events.some(e => e.uid === uid)) {
            events.push({
              uid,
              summary: inner,
              description: inner,
              start, end, isAllDay: false
            });
          }
          continue;
        }
      }

      if (singleHourMatch) {
        const sh = parseInt(singleHourMatch[1], 10);
        if (sh >= 7 && sh <= 22) {
          const start = new Date(Date.UTC(year, month - 1, day, sh - 1, 0, 0));
          const end = new Date(Date.UTC(year, month - 1, day, sh, 0, 0));
          const uid = `task-${taskId}@planning-finals`;
          if (!events.some(e => e.uid === uid)) {
            events.push({
              uid,
              summary: inner,
              description: inner,
              start, end, isAllDay: false
            });
          }
          continue;
        }
      }

      if (isImportant) {
        const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
        const end = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
        const uid = `task-${taskId}@planning-finals`;
        if (!events.some(e => e.uid === uid)) {
          events.push({
            uid,
            summary: inner,
            description: inner,
            start, end, isAllDay: true
          });
        }
      }
    }
  }

  return events;
}

module.exports = async (req, res) => {
  try {
    const html = await getPlanningHtml();
    const events = parseIcsEvents(html);

    const nowStr = formatIcsDate(new Date());
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Hira Sheikh//Planning Finals Q1//CA',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Planning Finals Q1',
      'X-WR-TIMEZONE:Europe/Madrid',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H'
    ];

    for (const ev of events) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${ev.uid}`);
      lines.push(`DTSTAMP:${nowStr}`);
      if (ev.isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(ev.start, true)}`);
        lines.push(`DTEND;VALUE=DATE:${formatIcsDate(ev.end, true)}`);
      } else {
        lines.push(`DTSTART:${formatIcsDate(ev.start)}`);
        lines.push(`DTEND:${formatIcsDate(ev.end)}`);
      }
      lines.push(`SUMMARY:${ev.summary.replace(/\n/g, ' ')}`);
      if (ev.description) {
        lines.push(`DESCRIPTION:${ev.description.replace(/\n/g, '\\n')}`);
      }
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    const icsContent = lines.join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="planning-finals.ics"');
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).send(icsContent);

  } catch (err) {
    console.error('ICS Generation Error:', err);
    return res.status(500).send('Error generating calendar feed');
  }
};
