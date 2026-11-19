# Smart Study Assistant & Universal Planner

A self-hosted, cloud-first study organizer and academic assistant template.

## Features
- **Interactive Planner**: Clean, mobile-friendly interface with chronological task sorting, inline editing, and state persistence.
- **Conversational AI Assistant**: Integrated study secretary powered by Google Gemini with multi-turn context and action confirmations.
- **Telegram Bot**: Manage tasks on the go with two-step interactive button confirmations.
- **Automated Briefings**: Morning agenda overview and evening check-ins via serverless cron jobs.
- **Calendar Feed**: Dynamic RFC 5545 `.ics` feed compatible with Apple Calendar, Google Calendar, and Outlook.
- **GitOps Persistence**: State and tasks stored directly in your GitHub repository.

## Deployment & Setup

1. Fork or clone this repository.
2. Deploy the project to [Vercel](https://vercel.com).
3. Set the following environment variables in Vercel:
   - `GH_TOKEN`: GitHub personal access token with repo permissions.
   - `GH_REPO`: Target repository (e.g., `your-username/smart-study-assistant`).
   - `GEMINI_API_KEY`: API key from Google AI Studio.
   - `TELEGRAM_BOT_TOKEN`: Token obtained from Telegram's BotFather.
   - `TELEGRAM_CHAT_ID`: Your personal Telegram chat ID.
4. Set up the Telegram webhook:
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_DOMAIN>/api/telegram"
   ```
5. Access the planner using the default PIN `study2026` (changeable in `index.html`).

## License
MIT License.
