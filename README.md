# 🤖 Autonomous Study Secretary & Planner

> **A 24/7 cloud-first personal study secretary and adaptive scheduler that turns everyday mobile messaging into real-time academic planning, Google Calendar synchronization, automated daily briefings, and interactive AI-driven schedule governance.**
>
> 💡 **Project Status & Continuous Engineering:**
> El projecte es troba en **desenvolupament i millora contínua activa**, optimitzant permanentment tant el **funcionament intern i l'arquitectura d'intel·ligència artificial (motor conversacional amb Gemini, sistema de confirmació interactiva mitjançant botons de Telegram, cascada de models per alta disponibilitat i sincronització GitOps bidireccional)** com l'ergonomia, creació de tasques en viu i usabilitat mòbil de la interfície d'usuari.

[![Powered by Gemini AI](https://img.shields.io/badge/AI_Engine-Gemini_Conversational-8E75B2?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Telegram](https://img.shields.io/badge/Bot-Telegram_Inline_Keyboards-2CA5E0?style=for-the-badge&logo=telegram)](https://telegram.org)
[![Google Calendar](https://img.shields.io/badge/Google_Calendar-Synced-4285F4?style=for-the-badge&logo=googlecalendar&logoColor=white)](https://calendar.google.com)
[![Apple Calendar](https://img.shields.io/badge/Apple_Calendar-Universal_iCal-000000?style=for-the-badge&logo=apple&logoColor=white)](https://www.apple.com)
[![Outlook](https://img.shields.io/badge/Microsoft_Outlook-RFC_5545-0078D4?style=for-the-badge&logo=microsoftoutlook&logoColor=white)](https://outlook.com)
[![Zero Cost](https://img.shields.io/badge/Infrastructure_Cost-%240_100%25_Free_Tier-success?style=for-the-badge)](https://github.com/hirasheiikh/smart-study-assistant)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

---

## 💡 The Story & Motivation

As an Informatics Engineering student balancing university finals at **UPC · FIB** and an industrial QA & AI model validation internship at **Grifols**, staying on top of coursework, exams, and project submissions requires disciplined scheduling.

Like many people who rely on digital tools, whenever inspiration, an exam date, or a coursework deadline crossed my mind on the go, **my instinctive habit was to jot down a quick note in my personal self-chat on WhatsApp, the phone's notes app, a sticky note on my PC, or a physical notebook**. We all do it!

**The real bottleneck, however, comes right after:** you end up with fragmented thoughts scattered across multiple places that you must manually organize, fit into realistic time slots between university lectures and work hours, and painstakingly type one by one into Google Calendar or Apple Calendar. That manual friction and cognitive load often means schedules become outdated or neglected.

I asked myself: *"How much easier would life be with a personal study secretary that bridges this gap? An assistant that listens to quick, raw notes on the go, fits them into my schedule, asks for confirmation before altering my agenda, keeps my digital calendars synchronized in real time, and checks in with me every morning and evening?"*

That was the spark for this project: transforming the natural habit of sending quick self-notes into an **autonomous, cloud-first study assistant** operating 24/7 with **zero ongoing infrastructure costs ($0)**.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph User["User Touchpoints"]
        Mobile["📱 Telegram Mobile (@Hira_PlanningBot)"]
        Web["💻 Responsive Web Planner (PWA)"]
    end

    subgraph Serverless["Cloud Core · Vercel Serverless ($0)"]
        Webhook["Telegram Webhook: api/telegram"]
        SyncAPI["Web Sync API: api/sync"]
        Cron["Automated Crons: api/cron"]
        CalendarFeed["Dynamic iCal Feed: calendar.ics"]
    end

    subgraph AIEngine["Gemini Multi-Model AI Engine"]
        Cascade["Cascada de Models (Gemini Flash Lite + Gemini 3 Flash)"]
        NLU["Conversational NLU & Clean Entity Extraction"]
    end

    subgraph Persistence["Git-as-a-Database & Output"]
        GH["GitHub API (Atomic Commits via SHA)"]
        TG["Telegram Bot API (Inline Keyboards & Callback Queries)"]
        Cal["Universal Calendar Sync (Apple, Google & Outlook)"]
    end

    Mobile -->|Casual Text or Voice Dictation| TG
    TG -->|POST Webhook| Webhook
    Webhook -->|Prompt & Context| Cascade
    Cascade -->|Structured Action or Conversational Chat| Webhook

    Webhook -->|Two-Step Approval Prompt with Inline Buttons| TG
    TG -->|User Clicks [✅ Sí, afegeix-la]| Webhook
    Webhook -->|Atomic Commit| GH
    Webhook -->|Edit Message in Place| TG

    Web -->|Inline Task Creation or Edit| SyncAPI
    SyncAPI -->|Commit| GH

    Cron -->|07:05 Morning & 21:30 Evening Briefings| TG
    CalendarFeed -->|RFC 5545 Live Feed| Cal
    Cal -->|Native Smartphone Calendar Integration| Mobile
```

---

## ✨ Full Feature Set

### 1. 🛑 Confirmació Interactiva per Botons de Telegram (Two-Step Governance)
* **Zero canvis accidentals:** El bot **mai afegeix, esborra ni mou tasques a cegues**.
* **Previsualització clara:** Sempre formula una proposta neta amb la data de destí, el text netejat de comandes i l'àmbit (*💼 Feina* o *🎓 Universitat*).
* **Botons integrats (*InlineKeyboardMarkup*):**
  * `[ ✅ Sí, afegeix-la ]` / `[ ❌ Cancel·la ]` per afegir.
  * `[ 🗑️ Sí, esborra-la ]` per eliminacions.
  * `[ ⏩ Sí, mou-la ]` per reprogramacions.
* **Actualització atòmica en viu:** Mitjançant `callback_query` i `editMessageText`, el missatge es transforma en una confirmació verda sense soroll al xat.

### 2. 🧠 Motor Conversacional amb Cascada Gemini (100% Uptime & Free Tier)
* **Respostes humanes, empàtiques i profundes:** Actua com el Gemini autèntic. No només classifica comandes, sinó que ofereix consells d'organització, acompanya en moments d'estrès davant d'exàmens com PAR o IDI, i xerra amb simpatia davant de salutacions com *«hola caracola»*.
* **Arquitectura de cascada multimodels:** Crida principal a **`gemini-flash-lite-latest`** (alta quota per dia, latència ultraràpida) amb fallback resilient a **`gemini-3-flash-preview`**. Això elimina qualsevol risc de saturació de quota (*429 Quota Exceeded*) mantenint un cost de **0,00 €**.
* **Neteja algorítmica de títols (`cleanTaskTitle`):** Elimina paraules com *«afegeix»*, *«posa»*, *«apunta»*, *«demà»* perquè a l'agenda només hi quedi la tasca pura (ex: *«afegeix fer idi dema»* ➔ *«Fer IDI»*).

### 3. 🌐 Creació i Edició Directa des del Planner Web
* **Botó global a la barra superior (`➕ Nova tasca`):** Finestra modal per triar el dia d'un desplegable, descriure la tasca, marcar si és de Grifols/feina i desar-la al moment.
* **Creació ràpida a cada fila (`＋ Afegir tasca`):** Cada dia del calendari disposa d'un botó subtil a la seva cel·la per obrir un camp d'escriptura immediat i afegir tasques prement Enter.
* **Edició i marcatge:** Doble clic o icona de llapis (✏️) per modificar qualsevol text, caselles de verificació instantànies i botó de moure de dia (⏩).
* **Sincronització en temps real (`api/sync`):** Tot canvi a la web es reflecteix a GitHub i està disponible immediatament per al bot de Telegram i els calendaris mòbils.

### 4. ⏰ Automated Cloud Briefings (Zero Computer Dependency)
* **07:05 AM Morning Briefing:** Envia el planning prioritzat del dia directament al mòbil per començar el matí amb focus.
* **21:30 PM Evening Check-in:** Revisa les tasques pendents, pregunta com ha anat la jornada i proposa reprogramacions.
* Executat mitjançant **Vercel Cloud Crons**: funciona 24/7 encara que l'ordinador estigui apagat.

### 5. 📅 Sincronització Universal de Calendaris (Apple, Google, Outlook)
* Generador natiu RFC 5545 d'iCalendar (`/calendar.ics`).
* Subscripció automàtica des d'iPhone (Apple Calendar), Android (Google Calendar) i Microsoft Outlook sense necessitat de sincronitzacions manuals.

---

## 🛠️ Stack Tecnològic

| Component | Tecnologia |
|---|---|
| **Motor d'IA & NLU** | Google Gemini (`gemini-flash-lite-latest` + `gemini-3-flash`) |
| **Backend Serverless** | Node.js (v20+), Vercel Serverless Functions, Vercel Crons |
| **Missatgeria & UX** | Telegram Bot API (Webhooks, Inline Keyboards, Callback Queries) |
| **Persistència (GitOps)** | GitHub REST API v3 (Git-as-a-Database, commits atòmics amb SHA) |
| **Calendari** | RFC 5545 iCalendar dynamic feed generator |
| **Frontend Web** | Vanilla HTML5, CSS3 Custom Properties, Web Crypto API (`crypto.subtle`) |

---

## 📄 Llicència

Distribuït sota llicència MIT. Consulta el fitxer `LICENSE` per a més informació.

---

<div align="center">
  <sub>Desenvolupat amb 💡 per <a href="https://github.com/hirasheiikh">Hira Sheikh Ahmed</a> · Enginyeria Informàtica (UPC · FIB) & QA/Validació de Models d'IA (Grifols)</sub>
</div>
