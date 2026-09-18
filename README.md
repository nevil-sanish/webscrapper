# Hack Scrapper

Discovers hackathons through Devfolio, Unstop, and Tavily (SerpApi backup), then syncs registration reminders to Google Calendar.

## Discovery

Every run covers all 14 Kerala districts using rotating, current-year queries. It also searches college/community announcements and independent event websites (including Vercel, Netlify and GitHub Pages). Two of the 20 query slots follow up on named events found in search results; Tamil Nadu and Karnataka receive two queries. Kerala receives 90% of the query slots.

Search results retain titles and snippets so unrelated court records, registration services, hotels, and tutorials can be rejected before page downloads. Relevant college listings supply links to individual event websites; listing pages themselves are not accepted as events. Social results can provide named-event leads but are not added to Calendar.

The crawler ranks candidates, follows up to two link levels, checks three pages concurrently, and limits work to 80 pages per run (with per-host limits). The report records accepted events, rejection reasons, and deferred URLs. JavaScript-only pages are rendered according to visible content or parse failure rather than HTML file size. Known event URLs are revisited without searching for them again. Seed sources in `scraper/search/sources.js` include the user-supplied HackAthena site and Kerala college/IEDC event listings; seeds must pass the same validation.

Web discovery avoids revisiting Unstop and Devfolio pages during a complete scrape, since their dedicated scrapers already traverse open listings. Unstop results are additionally checked for hackathon content to exclude quizzes, hiring tests, CTFs, and unrelated coding challenges.

Tavily uses basic search with automatic parameter selection disabled. SerpApi is used only when Tavily is unavailable or fails; empty successful results do not consume backup requests. Successful queries are cached for three days. Persistent monthly attempt budgets default to 900 Tavily and 80 SerpApi requests; failures are conservatively counted. These are local counters, not provider account usage measurements. Separate local/CI machines or lost caches cannot enforce an account-wide limit; provider billing limits still apply.

GitHub Actions restores/saves discovery state, serializes scraper runs, and uploads the discovery report. The state contains query/result metadata and counts, not API keys.

## Event eligibility

- Keep online hackathons without requiring prizes.
- Offline/hybrid events must have a venue in Kerala, Tamil Nadu, or Karnataka. Any offline round makes the event offline.
- Inspect full event descriptions and round content before truncating summaries.
- Registration deadlines must be today or later. Web parsing supports timeline cards such as `SEP 23 / REGISTRATION CLOSES`, inferring the year only from an explicit event date on the page. Event start dates alone are not used as web registration deadlines.
- Unrelated organizer locations do not qualify an outside venue. Unknown venues and unknown deadlines are reported rather than invented.

Discovery remains dependent on search indexing, accessible event content, and rule-based parsing. It cannot guarantee all hackathons, and posters or poorly labelled pages may need additional parsing support. Standalone web discovery follows HTML links; PDF posters can supply named-event leads but are not parsed as event pages.

## Calendar

Kerala events are green (`10`); other online events are blue (`9`), and other allowed offline events are red (`11`). Managed titles use `1 · Kerala · Name` or `2 · Name` to put Kerala first in title-sorted views. Google Calendar does not expose a per-event display-order field, so ordering cannot be guaranteed in every Calendar view.

At the start of each scrape, maintenance scans all Calendar pages, removes scraper-created reminders that ended before today, and updates retained managed events' colors/titles. For an all-day event, Google's exclusive end date at today's midnight means the event finished yesterday. Today's events and personal entries are preserved; recurring entries are left alone. Managed entries are recognized by private metadata or legacy `Mode:` and `Link:` description lines. Events outside the location policy are also removed. Old and prefixed names are matched to avoid duplicate insertion during migration.

## Configuration and verification

Add `TAVILY_API_KEY` to `.env` and your GitHub Actions repository secrets. Keep `SERP_API_KEY` as the optional backup. Configure Calendar credentials as shown in `.env.example`.

- `npm run scrape`: full scrape, maintenance, and Calendar sync.
- `npm run discover`: web discovery only; does not access Calendar.
- `npm test`: offline regression tests, including mocked Calendar maintenance and search fallback.

Optional settings: `TAVILY_MONTHLY_LIMIT`, `SERP_MONTHLY_LIMIT`, `SEARCH_QUERIES_PER_RUN`, `SEARCH_PAGES_PER_RUN`, and `CHROMIUM_PATH` for a system browser. Setting a budget to zero disables that part of discovery.

The ignored `scraper/search/discoveryReport.json` explains each run. The ignored `discoveryState.json` retains query caches, known event URLs, and monthly counters.
