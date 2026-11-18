# 🤖 Autonomous Study Secretary & Planner

> **A 24/7 cloud-first personal study secretary and adaptive scheduler that turns everyday mobile messaging into real-time academic planning, calendar synchronization, and automated daily briefings.**

[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Telegram](https://img.shields.io/badge/Bot-Telegram-2CA5E0?style=for-the-badge&logo=telegram)](https://telegram.org)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-Serverless_Crons-2088FF?style=for-the-badge&logo=githubactions)](https://github.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

---

## 💡 The Story & Motivation

As an Informatics Engineering student balancing challenging university courses and an industrial internship, staying organized across exams, lab deliverables, and reviews is a high-stakes challenge.

Like many people who prefer managing everything digitally, whenever inspiration strikes or a deadline looms while walking to class or working, **the instinctive reaction is to send a quick note to a "personal WhatsApp chat" or a self-DM**. We all do it! But notes get buried, plans drift out of date, and manual calendar updating becomes an extra chore that causes mental overload.

I kept thinking: ***"How much easier would life be if I had a personal secretary who listens to my quick thoughts on messaging apps, maintains my schedule, syncs my digital calendar, and checks in on me every morning and evening?"***

That was the spark for this project: transforming the natural habit of sending quick self-notes into an **autonomous, cloud-first study assistant** that works 24/7 with **zero ongoing infrastructure costs**.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph User["📱 User Interaction"]
        Mobile["Telegram App (Mobile / Desktop)"]
        Web["Responsive Web App / PWA"]
    end

    subgraph Serverless["⚡ Cloud Core (Vercel Serverless)"]
        Webhook["Telegram Webhook (/api/telegram)"]
        Cron["Automated Crons (/api/cron)"]
        CDN["Global Edge CDN Hosting"]
    end

    subgraph Integrations["🔌 Connected Services"]
        TG["Telegram Bot API"]
        GH["GitHub API (Git-as-a-Database)"]
        Cal["Google Calendar API"]
    end

    Cron -->|07:05 AM Briefing & 21:30 PM Check-in| TG
    TG -->|Push Notification| Mobile
    Mobile -->|Natural Text: 'done: lab 3', 'reschedule to Friday'| TG
    TG -->|POST Webhook| Webhook

    Webhook -->|Reads & Commits via SHA| GH
    Webhook -->|Instant Confirmation| TG
    GH -->|GitOps Trigger (Auto Deploy)| CDN

    Web -->|Client-side SHA-256 Auth| CDN
    Webhook -.->|Syncs Key Milestones| Cal
```

---

## ✨ Key Capabilities

1. **💬 Mobile Assistant on Telegram (24/7 Bi-directional):**
   - Text commands like `done with PAR lab` or `move BD review to tomorrow`.
   - The bot matches the task, updates the state file in GitHub, triggers an automated rebuild, and replies with confirmation within seconds.
   - Text `today` or `tomorrow` anytime for an immediate, numbered agenda.

2. **⏰ Automated Proactive Briefings (Zero Computer Dependency):**
   - **07:05 AM Briefing:** Delivers today's prioritized schedule and highlights any carry-over items from yesterday.
   - **21:30 PM Evening Check-in:** Reviews what was on today's agenda, asks what got completed, and prompts for any rescheduling.
   - Powered by **Vercel Cloud Crons**: runs seamlessly even if your laptop is powered off or in your backpack.

3. **📅 Digital Calendar Synchronization (Google Calendar):**
   - Direct integration to maintain a dedicated calendar (*e.g., "Planning Finals"*) for exams, critical submissions, and review milestones, keeping university deadlines separated from personal/work events.

4. **🔒 Private & Secure Progressive Web App:**
   - Single-Page Application (SPA) with progress tracking, interactive checkboxes, task rescheduling (`⏩`), and real-time state persistence.
   - Client-side cryptographic authorization (SHA-256) with local session persistence.
   - Git-as-a-Database: the source repository remains 100% private, with full audit trail across commits.

---

## 🛠️ Tech Stack & Tooling

- **Backend & Cloud:** Node.js (v20+), Vercel Serverless Functions, Vercel Crons.
- **Messaging:** Telegram Bot API (Webhooks & BotFather).
- **Storage & CI/CD:** GitHub REST API (v3), GitOps continuous deployment.
- **Frontend:** Vanilla HTML5, CSS3 Custom Properties, ES6+ Web Crypto API (`crypto.subtle`), LocalStorage API.
- **Calendar:** Google Calendar API v3.

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
4. Done! Your autonomous study assistant is live.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">
  <sub>Created with 💡 by <a href="https://github.com/hirasheiikh">Hira Sheikh Ahmed</a> · Informatics Engineering Student @ UPC (FIB)</sub>
</div>