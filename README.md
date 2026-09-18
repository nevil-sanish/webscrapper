# Hack Scrapper

Discovers hackathons through Devfolio, Unstop, and web search and syncs registration reminders to Google Calendar.

## Eligibility

- Keep online events without a prize requirement.
- Keep offline events only when the venue matches Kerala, Tamil Nadu, or Karnataka (including known city aliases).
- Treat hybrid events and events with any offline round as offline, even when the first round is online.
- Inspect full Devfolio page content, Unstop descriptions/rounds/stages, and discovered page content before shortening descriptions. Physical-round venues override online labels.
- Skip offline events whose venue cannot be resolved to an allowed location. Organizer names or unrelated state mentions do not qualify an event.
- Retain existing date checks: registration must be today or later; missing deadlines are skipped. Some sources fall back to event dates when no explicit registration deadline exists.

Attendance and venue detection uses text rules, not an LLM or geocoder. Ambiguous wording, unlisted city names without a state, inaccessible pages, and incomplete source data can still cause missed or misclassified events. Discovery cannot guarantee every hackathon.

## Kerala priority

`npm run scrape` searches all 14 Kerala districts every run, including separate Unstop and Devfolio queries for each district. It also searches common alternate spellings such as Kasargod and Kannaur. All keywords are scoped to Kerala, Karnataka, or Tamil Nadu.

There are 72 Kerala queries and 4 queries for the other two states: approximately 95% of search requests prioritize Kerala. Each run requests up to 10 results per query and inspects all unique eligible URLs, rather than stopping at 10 pages. This uses 76 SerpApi requests per run and can take substantially longer than the old five-query run; account quota still applies.

Devfolio and Unstop traverse available open-event pages without the old Unstop 15-page cap. Repeated pages stop traversal. Unstop is no longer limited to student listings. Kerala Devfolio entries are processed first and Kerala events are synced first.

The scheduled cleanup script shares the same eligibility rules and only manages entries with scraper Mode/Link markers. It does not re-fetch historical event pages; new scraping supplies updated round information.

## Run

Configure credentials in `.env` (see `.env.example`), then run `npm run scrape`.
Run local regression tests with `npm test`. Tests use fixtures and do not access external services or modify Calendar.
