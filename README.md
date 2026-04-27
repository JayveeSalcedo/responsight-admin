# ResponSight Admin — Agency Command Center

Web dashboard for emergency response agencies (CDRRMO, BFP, PNP). Built with Next.js 14, Tailwind CSS, and Supabase.

## Stack
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS (dark theme, Syne font)
- **Backend**: Supabase (shared with mobile app)
- **Charts**: Recharts
- **Icons**: Lucide React

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.local.example .env.local
# Fill in your Supabase URL and anon key

# 3. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/
│   ├── login/          # Auth page
│   ├── dashboard/      # Overview + live stats
│   ├── incidents/      # All emergency reports
│   ├── responders/     # Personnel management
│   ├── analytics/      # Sentiment + charts
│   ├── advisories/     # Push alerts to citizens
│   ├── feedback/       # Citizen feedback
│   └── settings/       # Agency config
├── components/
│   ├── layout/         # AppShell, Sidebar, TopBar
│   └── ui/             # StatCard, Badge
├── hooks/              # useAuth
├── lib/
│   ├── supabase/       # client, server, middleware
│   └── utils.ts
└── types/              # Shared TypeScript types
```

## Auth
Protected by Supabase Auth via middleware. All routes redirect to `/login` if unauthenticated.

## Connecting to Supabase
This shares the same Supabase project as the Flutter mobile app. Just paste the same `SUPABASE_URL` and `ANON_KEY` from the mobile app's `.env` file.
