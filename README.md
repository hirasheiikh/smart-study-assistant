# 🤖 Autonomous Study Secretary & Planner

> **A 24/7 cloud-first personal study secretary and adaptive scheduler that turns everyday mobile messaging into real-time academic planning, Google Calendar synchronization, and automated daily briefings.**

[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Telegram](https://img.shields.io/badge/Bot-Telegram-2CA5E0?style=for-the-badge&logo=telegram)](https://telegram.org)
[![Google Calendar](https://img.shields.io/badge/Google_Calendar-Synced-4285F4?style=for-the-badge&logo=googlecalendar&logoColor=white)](https://calendar.google.com)
[![Apple Calendar](https://img.shields.io/badge/Apple_Calendar-Universal_iCal-000000?style=for-the-badge&logo=apple&logoColor=white)](https://www.apple.com)
[![Outlook](https://img.shields.io/badge/Microsoft_Outlook-RFC_5545-0078D4?style=for-the-badge&logo=microsoftoutlook&logoColor=white)](https://outlook.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

---

## 💡 The Story & Motivation

As an Informatics Engineering student balancing university finals and an industrial AI/QA validation internship, staying on top of coursework, exams, and project submissions requires disciplined scheduling.

Like many people who rely on digital tools, whenever inspiration or a deadline crossed my mind on the go, **my instinctive habit was to send a quick note to my personal WhatsApp self-chat**. We all do it! But notes get scattered, plans drift out of date, and manual calendar management becomes another cognitive burden.

I asked myself: ***"How much easier would life be with a personal secretary who listens to quick mobile messages, maintains my schedule, automatically synchronizes my Google Calendar, and checks in on me every morning and evening?"***

That was the spark for this project: transforming the natural habit of sending quick self-notes into an **autonomous, cloud-first study assistant** operating 24/7 with **zero ongoing infrastructure costs**.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph User["User Interaction"]
        Mobile["Telegram Mobile App"]
        Web["Responsive Web App PWA"]
    end

    subgraph Serverless["Cloud Core Vercel Serverless"]
        Webhook["Telegram Webhook: api/telegram"]
        Cron["Automated Crons: api/cron"]
        CalendarFeed["Dynamic iCal Feed: calendar.ics"]
        CDN["Global Edge CDN Hosting"]
    end

    subgraph Integrations["Connected Services"]
        TG["Telegram Bot API"]
        GH["GitHub API: Git-as-a-Database"]
        Cal["Universal Calendar: Apple, Google & Outlook"]
    end

    Cron -->|Daily Morning and Evening Briefing| TG
    TG -->|Push Notification| Mobile
    Mobile -->|Natural Text Commands| TG
    TG -->|POST Webhook| Webhook

    Webhook -->|Reads and Commits via SHA| GH
    Webhook -->|Instant Confirmation| TG
    GH -->|GitOps Auto Deploy| CDN

    Web -->|Client-side SHA-256 Auth| CDN
    CalendarFeed -->|Live RFC 5545 Feed| Cal
    Cal -->|Syncs to Mobile Calendar| Mobile
```

---

## ✨ Full Feature Set

1. **💬 Mobile Assistant via Telegram (24/7 Bi-directional):**
   - Natural text commands: `done with PAR lab`, `move BD review to tomorrow`, or task numbers (`feta la 2`).
   - The bot matches the task, updates the state file in GitHub via API, triggers continuous deployment, and replies within seconds.
   - Type `today` or `tomorrow` anytime for an immediate, numbered schedule.

2. **⏰ Automated Cloud Briefings (Zero Computer Dependency):**
   - **07:05 AM Morning Briefing:** Delivers today's prioritized schedule and highlights any carry-over items from yesterday.
   - **21:30 PM Evening Check-in:** Reviews what was on today's agenda, asks what got completed, and prompts for any rescheduling.
   - Powered by **Vercel Cloud Crons**: runs seamlessly even if your laptop is powered off.

3. **📅 Universal Calendar Synchronization (Apple, Google, Outlook):**
   - Exposes a dynamic, standards-compliant RFC 5545 iCalendar feed (`/calendar.ics`).
   - Zero vendor lock-in: subscribe once from **Apple Calendar (iOS / iPadOS / macOS)**, **Google Calendar (Android / Web)**, or **Microsoft Outlook**, and all deadlines, reviews, and exams stay continuously synchronized across all devices and home screen widgets.

4. **🔒 Private & Secure Progressive Web App (PWA):**
   - Single-Page Application (SPA) with progress tracking, interactive checkboxes, task rescheduling (`⏩`), and real-time state persistence.
   - Client-side cryptographic authorization (SHA-256) with local session persistence ("Remember me on this device").
   - Git-as-a-Database: the source repository remains 100% private, with full audit trail across commits.

---

## 🛠️ Tech Stack & Tooling

- **Backend & Cloud:** Node.js (v20+), Vercel Serverless Functions, Vercel Crons.
- **Messaging:** Telegram Bot API (Webhooks & BotFather).
- **Calendar:** RFC 5545 iCalendar (iCal) dynamic feed generator, Google Calendar URL Subscription.
- **Storage & CI/CD:** GitHub REST API (v3), GitOps continuous deployment.
- **Frontend:** Vanilla HTML5, CSS3 Custom Properties, ES6+ Web Crypto API (`crypto.subtle`), LocalStorage API.

---

## 🚀 Quick Setup & Deployment

### 1. Prerequisites
- A GitHub account.
- A free [Vercel](https://vercel.com) account.
- A Telegram bot created via [@BotFather](https://t.me/BotFather).

### 2. Environment Variables
Configure the following secrets in your Vercel Project Settings:

```env
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
TELEGRAM_CHAT_ID="your_telegram_numeric_chat_id"
GH_TOKEN="your_github_personal_access_token_with_repo_scope"
```

### 3. Deploy in One Click
1. Fork or clone this repository.
2. Link the repository to your Vercel account.
3. Register the Telegram webhook:
   ```bash
   curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_DOMAIN>/api/telegram"
   ```
4. Subscribe to the Calendar Feed:
   - **Apple Calendar (iPhone/Mac):** Settings → Calendar → Calendar Accounts → Add Subscribed Calendar (paste `https://<YOUR_VERCEL_DOMAIN>/calendar.ics`).
   - **Google Calendar (Android/Web):** Other calendars (+) → From URL.
   - **Microsoft Outlook:** Add calendar → Subscribe from web.
5. Done! Your autonomous study assistant is live.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

<div align="center">
  <sub>Created with 💡 by <a href="https://github.com/hirasheiikh">Hira Sheikh Ahmed</a> · Informatics Engineering Student @ UPC (FIB)</sub>
</div>