# Tonicon 🎵

A minimal, mobile-first full-stack Next.js web application for Toni to log upcoming concerts, share gig details with friends, collect RSVPs ("I'm going", "Interested", comments), and archive past events.

---

## Features

- **Upcoming & Past Concerts**: Automatically categorizes concerts into **Upcoming** (sorted chronologically ascending) and **Past Concerts** (archived, non-editable).
- **Concert Cards**: Displays Band Name, Venue, Date & Time, YouTube video embeds, Toni's custom note, and an ordered timeline feed of friend responses.
- **Admin Password Protection**: Clicking **"Add a Concert"** requires entering Toni's secret password (`TONI_ADMIN_PASSWORD`).
- **Friend RSVPs & Bot Proof**: Friends can click "I'm going", "Interested", or "Comment". Asks for a name/pseudonym (saved in `localStorage` for future visits) and verifies a simple anti-bot math question.
- **Supabase Integration**: Live database persistence powered by Supabase.

---

## How to Run Locally

### Prerequisites

- Node.js 18+ and `npm` installed.
- A free [Supabase](https://supabase.com) account & project.

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/tonimateos/tonicon.git
cd tonicon
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory (or copy from `.env.example`):

```bash
cp .env.example .env.local
```

Fill in your Supabase project URL and Secret Key inside `.env.local`:

```env
# Supabase Database Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_key_here

# Secret Password for Toni to Add Concerts
TONI_ADMIN_PASSWORD=tonipass
```

### 3. Initialize Database Tables

1. Open your project dashboard at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** on the left menu $\rightarrow$ Click **New Query**.
3. Copy all SQL code from [`schema.sql`](./schema.sql), paste it into the editor, and click **Run**.

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application!

---

## Building for Production

To test or build the production bundle:

```bash
npm run build
npm start
```

---

## Tech Stack

- **Framework**: Next.js 15 (App Router, React 19, TypeScript)
- **Styling**: Tailwind CSS, Google Fonts (*Outfit* and *Inter*), Lucide Icons
- **Database**: Supabase (PostgreSQL)
