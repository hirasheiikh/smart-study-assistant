const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GH_REPO || 'your-username/smart-study-assistant';

function decodeEntities(str) {
  if (!str) return '';
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
      'User-Agent': 'SmartStudyCalendar'
    }
  });
  if (!res.ok) throw new Error(`GitHub get failed: ${res.status}`);
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf8');
}

function parseTimeRange(timeStr) {
  const m1 = timeStr.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (m1) {
    return {
      startH: parseInt(m1[1], 10),
      startM: parseInt(m1[2], 10),
      endH: parseInt(m1[3], 10),
      endM: parseInt(m1[4], 10)
    };
  }
  const m2 = timeStr.match(/(\d{1,2}):(\d{2})\s*(?:h|H)?/);
  if (m2) {
    const sh = parseInt(m2[1], 10);
    const sm = parseInt(m2[2], 10);
    return {
      startH: sh,
      startM: sm,
      endH: (sh + 1) % 24,
      endM: sm
    };
  }
  return null;
}

function formatIcsDateTime(dateStr, hour, minute) {
  const y = dateStr.slice(0, 4);
  const m = dateStr.slice(5, 7);
  const d = dateStr.slice(8, 10);
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}00`;
}

function formatIcsDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

function escapeIcsText(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldLine(line) {
  const max = 75;
  if (line.length <= max) return line;
  const parts = [];
  parts.push(line.slice(0, max));
  let i = max;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + max - 1));
    i += max - 1;
  }
  return parts.join('\r\n');
}

module.exports = async (req, res) => {
  try {
    const html = await getPlanningHtml();

    let doneSet = new Set();
    const stateMatch = html.match(/<script id="state"[^>]*>(.*?)<\/script>/s);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        (state.done || []).forEach(d => doneSet.add(d));
      } catch (e) {}
    }

    const events = [];
    const nowIso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const rowRegex = /<tr[^>]*data-day="(\d{4}-\d{2}-\d{2})"[^>]*>(.*?)<\/tr>/gs;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const day = rowMatch[1];
      const rowBody = rowMatch[2];
      const ulMatch = rowBody.match(/<ul class="tasks">(.*?)<\/ul>/s);
      if (!ulMatch) continue;
      const dayColMatch = rowBody.match(/<td[^>]*class="day-col"[^>]*>(.*?)<\/td>/s) || rowBody.match(/<td[^>]*>(.*?)<\/td>/s);
      const dayLabel = dayColMatch ? dayColMatch[1].replace(/<[^>]+>/g, '').trim() : day;
      const tasksHtml = ulMatch[1];

      const liRegex = /<li([^>]*)>(.*?)<\/li>/gs;
      let liMatch;

      while ((liMatch = liRegex.exec(tasksHtml)) !== null) {
        const attrs = liMatch[1];
        const rawContent = liMatch[2];
        const idMatch = attrs.match(/data-id="([^"]+)"/);
        const taskId = idMatch ? idMatch[1] : '';
        const isNote = attrs.includes('note');
        const isMovedAway = attrs.includes('movedaway');

        if (isMovedAway || !taskId) continue;

        const isDone = doneSet.has(taskId);
        const cleanText = decodeEntities(
          rawContent
            .replace(/<span class="cal-sync"[^>]*>.*?<\/span>/gi, '')
            .replace(/<[^>]+>/g, '')
        ).replace(/\s+/g, ' ').trim();
        const timeRange = parseTimeRange(cleanText);

        const summaryPrefix = isDone ? '✅ ' : '▫️ ';
        const summary = escapeIcsText(summaryPrefix + cleanText);
        const description = escapeIcsText(`Pla d'estudi · ${dayLabel} (${day})\nEstat: ${isDone ? 'Completat' : 'Pendent'}\nID Tasca: ${taskId}`);
        const uid = `task-${taskId}@smart-study-assistant`;

        if (timeRange) {
          const dtStart = formatIcsDateTime(day, timeRange.startH, timeRange.startM);
          const dtEnd = formatIcsDateTime(day, timeRange.endH, timeRange.endM);

          events.push([
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${nowIso}`,
            `DTSTART;TZID=Europe/Madrid:${dtStart}`,
            `DTEND;TZID=Europe/Madrid:${dtEnd}`,
            `SUMMARY:${summary}`,
            `DESCRIPTION:${description}`,
            `STATUS:${isDone ? 'CONFIRMED' : 'TENTATIVE'}`,
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            `DESCRIPTION:${escapeIcsText('Recordatori (30 min): ' + cleanText)}`,
            'TRIGGER:-PT30M',
            'END:VALARM',
            'END:VEVENT'
          ]);
        } else {
          const dtDate = formatIcsDate(day);
          const nextDayDt = new Date(day + 'T12:00:00Z');
          nextDayDt.setDate(nextDayDt.getDate() + 1);
          const nextDayStr = formatIcsDate(nextDayDt.toISOString().slice(0, 10));

          events.push([
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${nowIso}`,
            `DTSTART;VALUE=DATE:${dtDate}`,
            `DTEND;VALUE=DATE:${nextDayStr}`,
            `SUMMARY:${summary}`,
            `DESCRIPTION:${description}`,
            `STATUS:${isDone ? 'CONFIRMED' : 'TENTATIVE'}`,
            'END:VEVENT'
          ]);
        }
      }
    }

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Smart Study Assistant//Universal Study Planner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Smart Study Planner',
      'X-WR-TIMEZONE:Europe/Madrid',
      'X-WR-CALDESC:Sincronització en viu del calendari i tasques d\'estudi',
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M'
    ];

    events.forEach(ev => {
      ev.forEach(line => lines.push(foldLine(line)));
    });

    lines.push('END:VCALENDAR');

    const icsContent = lines.join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="study-planner.ics"');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    res.status(200).send(icsContent);

  } catch (err) {
    console.error('Calendar generation error:', err);
    res.status(500).send('Error generating calendar feed: ' + err.message);
  }
};
