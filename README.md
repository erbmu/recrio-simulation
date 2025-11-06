# Recrio AI Hiring Simulation

This repository hosts the Recrio AI-powered hiring simulation web client.

## Getting Started

```bash
# install dependencies
npm install

# start the dev server
npm run dev

# build for production
npm run build
```

## Tech Stack

- React + TypeScript (Vite)
- Tailwind CSS + shadcn/ui
- Supabase client SDK
- React Router & TanStack Query

## Project Structure

- `src/` – application code
- `public/` – static assets (favicons, robots.txt, etc.)
- `supabase/` – edge functions and database migrations

## Deployment

The app builds via `npm run build`. Deploy the `dist/` output to your hosting provider of choice (e.g., Render, Vercel, Netlify, or an S3 bucket behind a CDN).

## Contributing

1. Fork or clone the repo.
2. Create a feature branch.
3. Run linting/tests as needed.
4. Open a pull request with a clear description of your changes.
