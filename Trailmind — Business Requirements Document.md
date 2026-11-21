# Trailmind — Business Requirements Document

Nov 20, 2026 · @Folajimi

## Executive summary

**Trailmind** is a Chrome extension that remembers everything you read on the web, privately, and turns it into a living knowledge graph you can search, replay and ask questions of. Tagline: *Your browsing, remembered. On your device.*

On install, Trailmind reads up to 90 days of Chrome history and draws a graph of your searches, sites, sessions and journeys within a minute. A background job then re-reads public pages while the browser is idle, and Gemini Nano extracts topics, entities and facts from each one. From then on, every page you read is captured live.

The product is built on Firebase AI Logic hybrid inference. Every per-page job runs on-device with Gemini Nano, so it is private and costs nothing per call. Heavy, opt-in jobs (month-long summaries, audio, PDFs, very large pages) fall back to Gemini in the cloud. The hybrid split is the product, not a cost trick: nobody would let a cloud model read every page they visit.

Trailmind ships eleven capabilities on one shared core:

1. Knowledge graph with topic clusters and a timeline
2. Ask your memory (cited answers)
3. Journeys (search-to-outcome replays)
4. Open loops (unfinished reading, comparisons, forms)
5. Page snapshots (your copy survives link rot)
6. "Seen before" badge on related pages
7. Change watch on pages you revisit
8. Time questions ("what was I doing Tuesday?")
9. Weekly recap
10. Export to Markdown, Obsidian and Notion
11. Privacy controls, plus optional end-to-end encrypted sync

**Name note:** check that "Trailmind" is free on the Chrome Web Store, Devpost and your preferred domain before the first commit. Fallbacks: Hindsight, Tracewise, Mnemo.

## Problem and opportunity

People lose what they read. Browser history only matches page titles and URLs, so a fact, a price or a recommendation seen last week is effectively gone.

- **Recall fails.** Users remember *what* they saw, not *where*. They re-search, re-read and waste time.
- **Research is fragmented.** A single task (choosing a laptop, learning an API, planning a trip) spans dozens of tabs and days. Nothing records the path or the conclusion.
- **Work is left unfinished.** Half-read articles, abandoned comparisons and incomplete forms disappear when tabs close.
- **Pages change or vanish.** Docs get rewritten, products go out of stock, posts get deleted, and the user's evidence goes with them.
- **Cloud AI can't fix this.** Reading every page someone visits means reading their bank, email and health searches. Users won't send that to a server, and per-page cloud calls are too expensive at hundreds of pages a day.

**The opportunity:** Chrome now ships Gemini Nano on-device, and Firebase AI Logic routes between Nano and cloud Gemini through one API. For the first time, a model can read everything a user reads, locally and for free, with the cloud kept for the few jobs that need it. A memory product can now be both private and affordable.

### Competitive landscape

| Product | What it does | Gap Trailmind fills |
| --- | --- | --- |
| Chrome history and "Journeys" | Title and URL search, grouped visits | No page content, no facts, no answers, no graph |
| [BrowseGraph](https://devpost.com/software/browsegraph) (past Best Hybrid AI winner) | Browsing turned into a searchable knowledge graph with Gemini Nano, stored locally | No history backfill on install, no journeys, open loops, snapshots, change watch or recap; its page doesn't describe a clear cloud role |
| Cloud memory and "recall" tools | Screen or browser recording, cloud indexing | Privacy cost, subscription cost |
| Bookmark and read-later apps | Manual saving | Users must decide in advance what matters |

**Positioning against BrowseGraph:** Trailmind must not pitch "a graph of your browsing". That has been done and rewarded. The pitch is **"memory that acts"**: day-one backfill, journeys, open loops, change watch and recap, plus a hybrid design where every cloud call has a stated reason and a visible on-device or cloud badge.

## Goals, success metrics and judging alignment

Trailmind wins by scoring high on every judging criterion and by giving a reason for the hybrid design that no judge can miss. In the [2025 Chrome Built-in AI Challenge](https://developer.chrome.com/blog/ai-challenge-winners-2025), judges scored functionality, purpose, content, user experience and technical execution. The hybrid award went to entries with a clear reason for combining client-side and server-side AI. The #BuildHybridAI 2026 rules below are binding; the 2025 criteria guide how to score well until this year's judging criteria are confirmed.

### #BuildHybridAI 2026 rules and how Trailmind meets them

| Rule | How Trailmind meets it | BRD reference |
| --- | --- | --- |
| Build a Gen AI app using Firebase AI Logic | Every AI call goes through one module built on Firebase AI Logic hybrid inference | FR-AI-1, section 5 |
| Platform: Web (Chrome), Gemini Nano 4 via Firebase AI Logic, as a web app or Chrome extension | Chrome extension; submitted under the Web (Chrome) platform | Scope |
| Firebase AI Logic requires App Check (debug tokens accepted in submissions) | App Check enforced on every AI Logic call; a debug token documented for judges | FR-FB-1, SEC-6 |
| Use other Firebase products, such as Remote Config, Firestore and Authentication (encouraged) | Remote Config controls routing modes, prompts and thresholds; Authentication and Firestore power encrypted backup and sync | FR-FB-2 to FR-FB-6 |
| Any AI coding tool; Google tools like Antigravity recommended; coding agents work best with Firebase Agent Skills | Built with a coding agent using Firebase agent skills | DEV-1 to DEV-5 |
| Select at least one platform | Web (Chrome) | Submission checklist |
| Text description covering how Firebase AI Logic is used, the features and functionality, and a value proposition | Devpost write-up built from sections 1, 5 and 7 | Submission checklist |
| Existing apps must summarise what was built during the submission period | Trailmind is new; repository history starts inside the period | Submission checklist |

### Business goals

1. Win the hybrid AI prize (primary), and be eligible for the Chrome extension and most-helpful categories.
2. Ship a working, installable extension that judges can test on their own browser in under 2 minutes.
3. Show a hybrid design where each routing decision has a stated reason.
4. Leave a credible path to a real product: a free tier, plus paid encrypted sync.

### Judging alignment

| Criterion | How Trailmind scores |
| --- | --- |
| Functionality | 11 capabilities working end to end on real data; works offline; graceful fallback on unsupported devices |
| Purpose | Solves a universal, daily pain (lost information) that cloud-only AI cannot solve because of privacy |
| Content | Answers are cited to the exact passage; real user data in the demo, not mock-ups |
| User experience | Graph appears within 60 seconds of install; one-key search (Alt+M); clear badges for on-device or cloud |
| Technical execution | Firebase AI Logic hybrid routing, structured JSON output, local embeddings, encrypted IndexedDB, MV3 offscreen pipeline, clean open-source repo with tests |
| Hybrid justification | A routing table (section 5) states why each job runs where it does; a live "routing inspector" shows it in the demo |

### Product success metrics

| Metric | Target |
| --- | --- |
| Time from install to first graph | 60 seconds or less (metadata only) |
| Share of extraction jobs run on-device (supported devices) | 95% or more |
| Search answer latency, on-device | 3 seconds or less to first token |
| Answer correctness on a 50-question test set from the developer's own history | 80% or more cited correctly |
| Backfill coverage of public pages | 70% or more of eligible history URLs enriched |
| Data sent to cloud without user opt-in | 0 bytes of page content |

## Scope and users

### In scope

- Chrome extension (Manifest V3) for desktop Chrome.
- Local capture, extraction, storage, graph, search and all eleven capabilities listed in the executive summary.
- Firebase AI Logic hybrid inference (Gemini Nano on-device, Gemini in the cloud).
- Firebase backend only for: cloud model calls, optional sign-in and end-to-end encrypted sync blobs.
- Public landing page, demo video and open-source repository for submission.

### Out of scope

- Mobile browsers, Firefox, Safari (Chromium-based browsers such as Edge and Brave are best-effort, without on-device AI).
- Recording of incognito windows, ever.
- Capturing passwords, form field values typed by the user, or payment data.
- Server-side storage of readable page content.
- Team or shared memory (listed as future work only).

### Personas

| Persona | Context | Top jobs | Key features |
| --- | --- | --- | --- |
| Ada, developer | Reads docs, GitHub issues and Stack Overflow all day | "Where was that fix?"; resume yesterday's debugging trail | Ask memory, Journeys, Change watch on docs |
| Tunde, student | Researches assignments and exam prep across many sites | Find the source of a fact; weekly review of what he studied | Ask memory with citations, Weekly recap, Export to Notion |
| Chioma, shopper and planner | Compares products, apartments, flights and visa rules | Track prices and options she viewed; finish comparisons | Open loops, Change watch, Time questions |
| Sam, researcher or analyst | Long investigations over weeks | Keep evidence that may change or vanish; map topics | Snapshots, Graph clusters, Export to Obsidian |
| Judge | Has 5 minutes and a fresh browser | See value immediately and understand the hybrid split | Backfill on install, demo mode, routing inspector |

### User stories (headline)

- As a user, I can install Trailmind and see my last month of browsing as a grouped graph within a minute.
- As a user, I can ask a question in plain words and get an answer that cites the page and passage.
- As a user, I can replay a past research session and reopen its tabs.
- As a user, I can see things I started and didn't finish.
- As a user, I can recover the text of a page that has since changed or been deleted.
- As a user, I am told when a page I care about changes, in one sentence.
- As a user, I control exactly what is recorded and can delete anything, instantly.
- As a user, I can see for every AI answer whether it ran on my device or in the cloud.

## Platform constraints and hybrid routing

Every design choice below follows from what [Firebase AI Logic hybrid inference](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started?api=dev) can and cannot do on-device.

### What the platform gives us

| Capability | On-device (Gemini Nano via Chrome Prompt API) | Cloud (Gemini via Firebase AI Logic) |
| --- | --- | --- |
| Text input | Yes | Yes |
| Image input | JPEG and PNG only | Yes |
| Audio, video, PDF | No | Yes (preferred modes fall back here) |
| Structured output (JSON schema, enums) | Yes | Yes |
| Streaming | Yes | Yes |
| Multi-turn chat | No, single-turn only | Yes |
| Tools (function calling, grounding, URL context, code execution) | No | Yes, but not in hybrid mode requests that may run on-device |
| Files | Inline data only, no URLs | Inline or URL |
| Context budget (text and image) | About 9,216 tokens | Much larger |
| Default cloud model | n/a | gemini-3.5-flash-lite (overridable) |

Requirements: desktop Chrome 139 or later, the `prompt-api-for-gemini-nano-multimodal-input` flag enabled, Firebase AI Logic SDK 12.5.0 or later, enough disk space for the first model download, and `initializeDeviceModel()` called from a user action such as a button click.

### Design rules that follow

1. **Every AI job is one prompt that returns one JSON shape.** No job depends on chat history. Follow-up questions are rebuilt as a fresh single prompt containing the previous question and answer.
2. **Chunk to fit.** Page text is split into chunks of at most 2,500 tokens (leaving room for instructions and the schema). Long pages are summarised chunk by chunk, then merged with one final call.
3. **Retrieval happens in code, not in the model.** Nano has no tools, so search, ranking and graph lookups run in JavaScript. The model only reads the top passages and writes the answer.
4. **Embeddings run locally with a separate small model** (for example a quantised MiniLM via transformers.js on WebGPU or WASM). Gemini Nano does not provide embeddings.
5. **The model download is an onboarding step.** A clear "Enable on-device AI" button triggers `initializeDeviceModel()` and shows download progress.
6. **Token counts are estimates.** Counts differ between models, so chunking uses a conservative character-based estimate.
7. **Our own telemetry.** Firebase console AI monitoring shows no on-device data, so Trailmind logs routing outcomes locally (never content) for its own inspector.

### Hybrid routing table

This table is the core of the hybrid justification and is shown in the demo.

| Job | Mode | Why it runs there |
| --- | --- | --- |
| Page extraction (topic, entities, facts, type) | ONLY\_ON\_DEVICE | Runs on every page; content is private; must cost nothing. Never falls back to cloud. If Nano is missing, store metadata only and retry later. |
| Cluster naming and summaries | PREFER\_ON\_DEVICE | Input is our own extracted labels, not raw pages; low sensitivity |
| Ask memory (answers over retrieved passages) | PREFER\_ON\_DEVICE | Passages are private; cloud fallback only if the user turned on "Cloud answers" |
| Open-loop and journey summaries | PREFER\_ON\_DEVICE | Small inputs, frequent |
| Change-watch diff summary | PREFER\_ON\_DEVICE | Small diff, runs in the background |
| Image understanding (charts, screenshots on a page) | PREFER\_ON\_DEVICE | JPEG and PNG are supported on-device |
| PDFs, audio, video on pages the user saves | PREFER\_IN\_CLOUD, opt-in per item | Not supported on-device |
| Month or topic "deep summary" over many pages | PREFER\_IN\_CLOUD, opt-in | Exceeds the on-device context budget; uses only extracted facts, not raw pages |
| Weekly recap | PREFER\_ON\_DEVICE, with optional cloud polish | Built from local stats and facts |
| Phishing-style "sensitive page" detection before capture | ONLY\_ON\_DEVICE | Decides whether a page is recorded at all; must never leave the device |

**Cloud data rule:** cloud requests carry only the minimum text needed (extracted facts or the user's selected item), never full browsing history, and each one is shown in the routing inspector with what was sent.

## Architecture and data model

Trailmind is one Manifest V3 extension with a single local pipeline: capture, queue, extract, store, then the graph and features on top. Firebase is used only for cloud model calls and optional encrypted sync.

&#91;embedded content: Trailmind architecture · capture to features\]

Three sources feed one queue in the service worker. The offscreen document runs the Firebase AI Logic SDK and embeddings, because MV3 service workers have no DOM. Every feature reads from the same encrypted store through the graph engine.

### Components

| Component | Runs in | Responsibility |
| --- | --- | --- |
| Content script | Each tab | Readable text, read depth, active time, highlights, images; "seen before" chip |
| History importer | Service worker | `chrome.history` and `chrome.bookmarks` import, search parsing, sessions |
| Background re-fetcher | Offscreen document | Idle-time fetches of public pages, rate limits, parse to text |
| Service worker | Background | Job queue, alarms (watch, recap), privacy filters, routing, messaging |
| AI module | Offscreen document | Firebase AI Logic hybrid calls, schemas, repair retry, routing log |
| Embedding module | Offscreen document | Local sentence embeddings, vector index |
| Store | IndexedDB via Dexie | Encrypted records, migrations, pruning |
| Graph engine | Offscreen document or side panel worker | Clustering, edges, journeys, loops, diffs, time index |
| UI | Side panel, popup, overlay, full-page app | All screens in section 10 |
| Firebase backend | Cloud | AI Logic cloud model, Auth, App Check, encrypted sync blobs |

### Data model

| Store | Key fields | Notes |
| --- | --- | --- |
| pages | id, url, canonical\_url, domain, title, type, summary, language, first\_seen, last\_seen, status (full, metadata\_only, gone), prompt\_version | One per canonical URL |
| visits | id, page\_id, time, active\_ms, max\_scroll, referrer\_visit\_id, transition, session\_id | From history and live capture |
| snapshots | id, page\_id, captured\_at, content\_hash, text (encrypted), images | Last 5 versions per page |
| chunks | id, page\_id, snapshot\_id, text (encrypted), token\_estimate | Retrieval units |
| facts | id, page\_id, chunk\_id, text (encrypted), from\_image, highlight | Up to 8 per page plus highlights |
| nodes | id, kind (search, page, site, topic, entity, journey, highlight), label, cluster\_id, weight | Graph nodes |
| edges | id, from, to, kind, weight, first\_seen | Graph edges |
| embeddings | owner\_id, owner\_kind, vector (int8) | For pages, chunks and facts |
| clusters | id, name, summary, user\_renamed, pinned, hidden | Stable ids across re-runs |
| sessions and journeys | id, start, end, entry, exit, page\_ids, name, outcome, state | One journey per session |
| loops | id, kind, page\_ids, reason, state, snooze\_until | Open loops |
| watches | id, page\_id, interval, price\_target, last\_check, changes\[\] | Change watch |
| recaps | id, week, stats, text | Weekly recap |
| settings | exclusions, capture, cloud toggles, storage budget, shortcuts | Synced if sync is on |
| jobs | id, kind, priority, state, attempts, payload\_ref | Persistent queue |
| routing\_log | id, job\_kind, mode, ran\_on, ms, cloud\_payload\_preview | No page content except the cloud preview the user sees |

## Functional requirements

Requirements are numbered `FR-<area>-<n>`. Priority: **M** = must ship for the hackathon, **S** = should ship, **C** = could ship if time allows. Every M requirement has an acceptance test in the last column.

### A. Onboarding and setup

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-ON-1 | On install, open a welcome tab explaining what is recorded, what never is, and where data lives | M | Tab opens on first install; copy names incognito, passwords and payments as never recorded |
| FR-ON-2 | Check on-device AI readiness (Chrome version, flag, model availability, disk space) and show a clear status | M | Each check shows pass or fail with a fix-it link |
| FR-ON-3 | "Enable on-device AI" button calls `initializeDeviceModel()` and shows download progress | M | Model downloads after the click; progress bar updates |
| FR-ON-4 | Ask permission to import history (default 30 days, options 7, 30 or 90 days) | M | Declining skips import; the product still works going forward |
| FR-ON-5 | Default exclusion list pre-filled (banks, email, health, government ID portals, password managers); user can edit before import | M | Excluded domains are never fetched or stored |
| FR-ON-6 | Demo mode: load a bundled sample graph for judges without real history | M | One toggle loads sample data; a banner says it is sample data |
| FR-ON-7 | Fallback when Nano is unavailable: metadata-only mode, plus optional opt-in cloud extraction | M | Unsupported device still shows a graph from history metadata |

### B. Capture (live pages)

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-CAP-1 | Capture a page after it is visible for at least 20 seconds, or scrolled at least 30%, whichever comes first | M | Short bounces are not captured |
| FR-CAP-2 | Extract readable text with a Readability-style parser in the content script; strip nav, ads and comments by default | M | Captured text matches article body on 10 test sites |
| FR-CAP-3 | Never capture incognito tabs, excluded domains, `chrome://` pages, or pages detected as sensitive (FR-PRV-6) | M | Verified by automated test per rule |
| FR-CAP-4 | Never read values of input fields, password fields or payment forms | M | Content script reads no `input.value` |
| FR-CAP-5 | Record read depth (max scroll %), active time, and whether the user returned later | M | Fields stored per visit |
| FR-CAP-6 | Capture user highlights (text selection plus Alt+H) as "highlight" facts linked to the page | S | Highlight appears on the page node |
| FR-CAP-7 | Capture images on the page that are charts or diagrams (JPEG or PNG, over 200 by 200 px, max 3 per page) for Nano image description | S | Description stored and searchable |
| FR-CAP-8 | Re-capture a page on revisit only if its content hash changed | M | No duplicate snapshots for unchanged pages |
| FR-CAP-9 | Handle single-page apps: re-capture on URL change via `history.pushState` | S | Navigating inside GitHub creates separate page records |
| FR-CAP-10 | Pause capture globally or per tab from the toolbar | M | Paused state shown on icon badge |

### C. History backfill

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-BF-1 | Read history with `chrome.history.search` and `getVisits` for the chosen window | M | All visits in range loaded |
| FR-BF-2 | Build a metadata graph (sites, pages, searches, sessions, referrer chains) before any page fetch | M | Graph visible within 60 seconds for 5,000 visits |
| FR-BF-3 | Parse search queries from URLs of Google, Bing, DuckDuckGo, YouTube, GitHub, Stack Overflow, Amazon and Jumia, and allow custom patterns | M | Queries appear as search nodes |
| FR-BF-4 | Split visits into sessions: a gap of 30 minutes or more starts a new session | M | Sessions match the rule in tests |
| FR-BF-5 | Background re-fetch of eligible public URLs, using the extension's fetch with credentials omitted | M | Re-fetch runs only when browser is idle |
| FR-BF-6 | Rate limits: at most 1 request per domain per 5 seconds, at most 4 in parallel, pause on battery saver | M | Measured in logs |
| FR-BF-7 | Skip and mark as "metadata only": login-gated, paywalled, empty-shell JavaScript pages and non-200 responses | M | Marked nodes shown with a dashed outline |
| FR-BF-8 | Upgrade metadata-only nodes to full nodes when the user revisits the page live | M | Node becomes solid after revisit |
| FR-BF-9 | Show backfill progress (pages done, pages left, estimated time) and allow pause | M | Progress visible in side panel |
| FR-BF-10 | Import bookmarks as high-importance page nodes | S | Bookmarked pages are flagged |

### D. Extraction (AI)

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-EX-1 | For each captured page, one on-device call returns JSON: `title`, `summary` (max 40 words), `type` (article, docs, product, thread, video, search results, tool, other), `topics` (1 to 5), `entities` (name and kind: person, org, product, place, tech, other), `facts` (max 8, each under 30 words), `price` (if product), `language` | M | Output validates against the schema for 95% of pages; invalid output is retried once with a repair prompt |
| FR-EX-2 | Chunk long pages (FR rule: max 2,500 tokens per chunk), extract per chunk, then merge | M | A 20,000-word page yields one merged record |
| FR-EX-3 | Queue extraction jobs with priority: live pages first, then backfill | M | Live page extracted within 10 seconds of capture |
| FR-EX-4 | Compute a local embedding for the summary, each fact, and each chunk | M | Embeddings stored and searchable |
| FR-EX-5 | Normalise entities (case, aliases, plural) and merge duplicates (for example "Firebase" and "Google Firebase") | M | Duplicate rate under 5% on test set |
| FR-EX-6 | Detect page language; extract in the page's language and store an English topic label for clustering | S | French and Yoruba pages cluster with English ones on the same topic |
| FR-EX-7 | Image description for captured images (FR-CAP-7) as facts tagged `from_image` | S | Chart text searchable |
| FR-EX-8 | Record routing outcome per job (on-device, cloud, failed) and duration, with no content | M | Shown in routing inspector |

### E. Storage

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-ST-1 | Store everything in IndexedDB, encrypted with AES-GCM using a key held in the extension (and optionally wrapped by a passphrase) | M | Raw IndexedDB inspection shows ciphertext only for content fields |
| FR-ST-2 | Stores: `pages`, `visits`, `snapshots`, `nodes`, `edges`, `embeddings`, `journeys`, `loops`, `watches`, `settings`, `jobs`, `routing_log` | M | Schema matches section 6 |
| FR-ST-3 | Storage budget setting (default 1 GB) with oldest-first pruning of snapshot bodies (metadata kept) | M | Pruning triggers at budget |
| FR-ST-4 | Request `unlimitedStorage` permission | M | Listed in manifest |
| FR-ST-5 | Schema versioning with migrations | M | Upgrade from v1 to v2 test passes |

### T. Firebase platform services (required and encouraged by the hackathon)

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-FB-1 | Firebase App Check enforced on all Firebase AI Logic calls; the debug provider and token are documented in the judges' testing instructions | M | Calls without a valid App Check token are rejected; judges can run with the debug token |
| FR-FB-2 | Remote Config template holds per-job InferenceMode, cloud model name, "seen before" similarity threshold, backfill rate limits, change-watch interval default, and a cloud kill switch | M | Changing a value in the console changes behaviour after the next fetch, with no new build |
| FR-FB-3 | Bundled Remote Config defaults so the extension works offline and on first run before any fetch | M | Airplane-mode first run uses defaults |
| FR-FB-4 | Prompt templates and schema versions served through Remote Config as data (not code, so allowed under MV3), with the bundled version as fallback | S | A prompt tweak ships without a store update; records note the prompt version |
| FR-FB-5 | Firebase Authentication (Google sign-in), optional, used only for backup and sync | M | Sign-in and sign-out work; nothing is required to use the core product |
| FR-FB-6 | Firestore encrypted backup of settings, exclusions, cluster names, watches and recaps (ciphertext only, encrypted on-device); full memory sync stays under section Q | M | Backup restores on a second device after passphrase entry; Firestore shows only ciphertext |
| FR-FB-7 | Firestore Security Rules allow each user to read and write only their own documents; rules tested in the Local Emulator Suite and audited with the firestore-security-rules-auditor skill | M | Emulator tests pass; audit has no high findings |
| FR-FB-8 | The routing inspector shows the active Remote Config values for routing, so judges can see the hybrid policy is configurable | S | Values visible in the inspector |

## Non-functional requirements

Targets assume a mid-range laptop (8 GB RAM, integrated GPU) running desktop Chrome 139 or later with Gemini Nano available.

### Performance

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-PF-1 | Page load overhead from the content script | Under 20 ms added to main thread; script injected at `document_idle` |
| NFR-PF-2 | Metadata graph after install | Under 60 seconds for 5,000 visits |
| NFR-PF-3 | Live page extraction | Done within 10 seconds of capture (median) |
| NFR-PF-4 | Backfill throughput | At least 300 pages per hour while idle |
| NFR-PF-5 | Search popup open | Under 200 ms |
| NFR-PF-6 | Search results list | Under 300 ms for 20,000 pages |
| NFR-PF-7 | On-device answer, first token | Under 3 seconds |
| NFR-PF-8 | Graph render | 30 frames per second or better at 5,000 visible nodes |
| NFR-PF-9 | "Seen before" lookup | Under 500 ms |
| NFR-PF-10 | Memory use of the extension | Under 300 MB steady state, excluding the Nano model managed by Chrome |
| NFR-PF-11 | CPU while browsing | Background AI jobs paused while the user is typing, a video plays, or on battery saver |

### Scalability and storage

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-SC-1 | Pages supported | 50,000 pages without slowdown beyond the targets above |
| NFR-SC-2 | Storage per page | About 20 KB average (text, facts, embeddings) |
| NFR-SC-3 | Vector index | In-memory HNSW or flat index with quantised vectors (int8); rebuilt lazily |
| NFR-SC-4 | Storage budget | Default 1 GB, user configurable, pruning per FR-ST-3 |

### Reliability

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-RL-1 | Job queue survives service worker restarts and browser restarts | Jobs persisted in IndexedDB; resume on startup |
| NFR-RL-2 | No data loss on crash | Writes are transactional |
| NFR-RL-3 | Graceful degrade when Nano is missing or busy | Metadata mode, queued jobs, clear banner; no errors shown to the user as stack traces |
| NFR-RL-4 | Invalid model output | Schema check plus one repair retry (FR-AI-3) |
| NFR-RL-5 | Offline | All features except cloud jobs and sync work fully offline |

### Compatibility

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-CP-1 | Browser | Desktop Chrome 139 or later, Windows, macOS, Linux and ChromeOS |
| NFR-CP-2 | Manifest | Manifest V3; no remotely hosted code; all libraries bundled |
| NFR-CP-3 | Sites | Capture verified on the 50 most-visited site types (news, docs, GitHub, Stack Overflow, YouTube, e-commerce, Wikipedia, Medium, Reddit, X) |
| NFR-CP-4 | Languages | UI in English; capture and extraction work for any language Nano supports; at least English, French and Yoruba tested |

### Usability and accessibility

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-UX-1 | First value | User sees their own graph within 1 minute of clicking install |
| NFR-UX-2 | Accessibility | WCAG 2.2 AA: full keyboard navigation, focus states, screen reader labels; graph has a list view alternative |
| NFR-UX-3 | Themes | Light and dark, following the system setting |
| NFR-UX-4 | Plain-language copy | Every AI result says where it ran; every privacy setting explained in one sentence |
| NFR-UX-5 | Responsive side panel | Usable from 320 px to full width |

### Maintainability and quality

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-MT-1 | Language and build | TypeScript (strict), Vite build, ESLint and Prettier |
| NFR-MT-2 | Tests | Unit tests for parsers, sessioniser, loops and diffs; integration tests for the pipeline with a mocked model; Playwright end-to-end tests loading the unpacked extension |
| NFR-MT-3 | Model evaluation set | 50 recall questions, 10 unanswerable questions, 30 extraction pages with expected JSON; run on each prompt change |
| NFR-MT-4 | Code structure | Core modules (capture, backfill, extract, store, graph, ai) separate from feature modules; features talk to core only through typed interfaces |
| NFR-MT-5 | Documentation | README with setup (including enabling the Nano flag), architecture diagram, routing table, and privacy model |
| NFR-MT-6 | Licence | Open source (MIT or Apache 2.0), per hackathon rules |

### Observability (without content)

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-OB-1 | Local logs | Job counts, durations, routing outcomes, errors; never page content or URLs |
| NFR-OB-2 | Optional anonymous usage stats | Off by default; counts only |
| NFR-OB-3 | Debug panel | Hidden developer view for queue state, index size and model status |

## Privacy, security and compliance

Privacy is the product: Trailmind must be able to prove that page content stays on the device unless the user sends it.

### Privacy principles

1. **Local by default.** All page content, facts, embeddings and snapshots live only in the user's browser.
2. **Minimum to cloud.** Cloud calls happen only after opt-in, carry only extracted facts or the user's selected item, and are listed in the routing inspector.
3. **Never recorded:** incognito, excluded domains, typed input values, passwords, payment fields, and pages flagged as sensitive.
4. **Delete means delete.** Forget actions remove records, snapshots, embeddings and graph edges immediately.
5. **No ads, no selling, no training** on user data, stated in the privacy policy.

### Security requirements

| ID | Requirement |
| --- | --- |
| SEC-1 | Encrypt content fields at rest with AES-GCM 256 (WebCrypto); a random data key per install, stored as a non-extractable `CryptoKey` in IndexedDB; optional passphrase wrapping (PBKDF2-SHA256, 600,000 iterations, or Argon2id via WASM) |
| SEC-2 | Content Security Policy: no `eval`, no remote scripts; only the Firebase endpoints the SDK needs are allowed in `connect-src` |
| SEC-3 | Minimal permissions: `history`, `storage`, `unlimitedStorage`, `tabs`, `tabGroups`, `sidePanel`, `offscreen`, `alarms`, `notifications`, `scripting`, `bookmarks`; host permissions requested at onboarding with a clear reason; optional permissions for Notion export |
| SEC-4 | Treat all page text as untrusted: prompts wrap page content in clearly delimited blocks and instruct the model to ignore instructions inside it (prompt-injection defence); outputs are schema-validated and rendered as text, never as HTML |
| SEC-5 | Sanitise any HTML shown in the snapshot viewer (DOMPurify), and render it in a sandboxed page with no script execution |
| SEC-6 | Firebase App Check enforced on all Firebase AI Logic calls (required by the hackathon; debug tokens are accepted for the submission). Test early which App Check provider works from a Chrome extension origin, and keep per-user quotas as a second guard |
| SEC-7 | Firebase security rules: sync data readable and writable only by its owner; the server never holds decryption keys |
| SEC-8 | Background fetches omit cookies (`credentials: 'omit'`), so backfill never acts as the logged-in user |
| SEC-9 | Dependency scanning (npm audit, Dependabot) and a pinned lockfile |
| SEC-10 | Threat model document covering a malicious page, a malicious extension, a stolen laptop, and a compromised Firebase project |

### Compliance

- **Chrome Web Store policies:** single clear purpose ("personal browsing memory"), Limited Use disclosure for history data, a privacy policy page, and prominent disclosure before collecting browsing activity.
- **Data protection laws:** design to GDPR and Nigeria's NDPA principles: consent before collection, purpose limitation, data minimisation, the right to access (export) and erasure (forget), and no transfer of personal data without consent.
- **Children:** not directed at children under 13; stated in the policy.
- **Hackathon rules:** check the Devpost rules for required APIs, open-source licence, video length and testing instructions, and meet each one.

## UX requirements and screens

The interface has one home, the side panel, plus three small surfaces that come to the user. Every screen must make two things obvious: what Trailmind knows, and where each answer was computed.

### Surfaces

| Surface | Opened by | Purpose | Contents |
| --- | --- | --- | --- |
| Toolbar popup | Click the icon | Status at a glance | Recording state, pause, "forget last 15 min", today's pages count, open-loop count, quick search box |
| Search overlay | Alt+M on any page | Ask memory | Search box, instant results, streamed answer with citations, on-device or cloud badge |
| Side panel | Toolbar, or Alt+G | The main app | Tabs: Graph, Journeys, Loops, Watch, Recap, Inspector |
| In-page chip | Automatic | "Seen before" | Small chip in the corner, dismissable, never over page content |
| Notifications | Change watch, recap | Proactive alerts | One-sentence summary and an "open" action |
| Full-page app | "Open full view" | Big graph, settings, privacy dashboard, snapshot viewer | Same tabs, wider layout |

### Screen requirements

| Screen | Must show |
| --- | --- |
| Welcome and onboarding | 3 steps: what we record (and never), enable on-device AI with progress, import history range and exclusions; "Try demo data" link |
| Backfill progress | Live counter, graph filling in behind it, pause button, "you can keep browsing" message |
| Graph | Cluster bubbles sized by page count, colour by cluster, timeline slider at the bottom, filters on the left, node drawer on the right, list-view toggle |
| Ask results | Answer at top with numbered citations; list of pages below; "no answer" state; follow-up box |
| Journey | Path of page cards left to right with branch rows; outcome summary; "Resume" button |
| Open loops | Cards grouped by type (reading, comparing, forms, saved); reason line; done, snooze, dismiss |
| Change watch | Watched pages with last change and history; suggestions; price target input |
| Recap | Week header, top topics, discoveries, time chart by cluster, loops, changes; archive |
| Routing inspector | Live job list (job, mode, ran where, ms), on-device share, list of cloud calls with exact payload preview |
| Privacy dashboard | Storage used, pages stored, exclusions, forget controls, cloud call log, export and delete-all |
| Settings | All settings in sections (FR-SET-1) |

### Design rules

- One accent colour; clusters use a muted categorical palette that works in light and dark themes.
- Badges: a small device icon for on-device and a cloud icon for cloud, always beside AI text.
- Empty states teach: each one gives one sentence explaining the feature and one action.
- Motion only for meaning: the backfill fill-in and the timeline play button.
- Never block browsing: no modal dialogs on web pages; the chip is the only thing injected into pages.

## Risks, assumptions and dependencies

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Looks like a copy of BrowseGraph, a past hybrid winner | Judges discount novelty | Lead the pitch with journeys, open loops, change watch and day-one backfill; never call it "a browsing graph"; show the routing inspector |
| Judges' machines lack Nano or the flag | Demo fails for them | Demo mode with sample data; clear setup checklist; metadata mode; optional cloud extraction; video shows the real thing |
| Nano output is weak or invalid JSON | Bad facts, broken graph | Tight schemas, short prompts, one repair retry, evaluation set run on every prompt change |
| Backfill fetches return empty pages (JavaScript apps, logins) | Thin graph on day one | Metadata-only nodes, upgraded on revisit; readable text extraction tuned on the top 50 sites |
| Background AI slows browsing | Users uninstall | One job at a time, pause on typing, video and battery saver; throttled fetches |
| Prompt injection from page text | Wrong or harmful output | Delimited content, ignore-instructions rule, schema validation, output rendered as text only |
| Firebase SDK behaviour inside MV3 (service worker has no DOM) | AI calls fail | Run the SDK in an offscreen document; spike this first |
| Cloud key abuse | Cost, quota exhaustion | App Check enforced (a hackathon requirement), plus per-user quotas set in Remote Config |
| Chrome Web Store review rejects broad history use | Can't publish | Clear single purpose, prominent disclosure, privacy policy; submit early; judges can load unpacked |
| Scope: eleven capabilities | Unfinished features | Build the core first; each feature is a view over the core; keep sync optional |
| Name clash: "Trail" was a past hybrid web-app winner | Confusion | Check names; consider Hindsight or Tracewise if judges may confuse them |

### Assumptions

- The #BuildHybridAI 2026 rules excerpt reviewed sets requirements but not judging criteria; the 2025 Chrome Built-in AI Challenge criteria (functionality, purpose, content, UX, technical execution, plus a reason for the hybrid design) are used as a guide until confirmed.
- Judges will test on desktop Chrome and can enable a flag if told how.
- Chrome keeps about 90 days of history, so a 30-day import is always available for active users.
- Gemini Nano's on-device context stays around 9,216 tokens.

### Dependencies

| Dependency | Used for |
| --- | --- |
| Firebase AI Logic Web SDK 12.5.0 or later | Hybrid inference |
| Chrome Prompt API (Gemini Nano) | On-device model |
| Firebase Authentication, Firestore or Cloud Storage, App Check, Cloud Functions | Sync, abuse protection, cloud proxy |
| transformers.js with a small sentence-embedding model | Local embeddings |
| Mozilla Readability (or similar) | Readable text extraction |
| Sigma.js or Cytoscape.js, graphology | Graph rendering and algorithms |
| MiniSearch or FlexSearch | Keyword search |
| Dexie (IndexedDB wrapper) | Storage |
| chrono-node | Time phrase parsing |
| diff-match-patch | Change watch diffs |
| DOMPurify | Snapshot sanitising |
| JSZip | Export |
| Vite, TypeScript, Vitest, Playwright | Build and test |

## Coding-agent setup: Firebase agent skills

Trailmind is built with an AI coding agent that has the official [Firebase agent skills](https://firebase.google.com/docs/ai-assistance/agent-skills#other) installed, as the hackathon recommends. The skills are portable modules of Firebase knowledge and workflows, each built around a `SKILL.md` file, that help the agent follow Firebase best practices. They live in the [firebase/agent-skills](https://github.com/firebase/agent-skills) repository.

The rules allow any AI coding tool, as long as the app's AI runs on Firebase AI Logic. They recommend Google tools such as Antigravity, where the Firebase agent skills come built in (as they do in Android Studio). With Claude Code, Codex or Cursor, install them with the command below.

### Requirements

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| DEV-1 | Install the Firebase agent skills in the repo before any Firebase code is written | M | Skills listed by the agent; install command recorded in the README |
| DEV-2 | Connect the Firebase MCP server to the coding agent (recommended alongside the skills) | S | Agent can list the Firebase project |
| DEV-3 | Commit an agent instructions file (`AGENTS.md`, plus `CLAUDE.md` or the agent's equivalent) that tells the agent which skill to use for which part of Trailmind | M | File present at repo root with the mapping below |
| DEV-4 | Update skills before each major build step | S | `npx skills update --all` run; noted in the changelog |
| DEV-5 | Mention the skills and the agent workflow in the Devpost write-up | M | "Built with" section names Firebase agent skills |

### Install

For agents other than the built-in marketplace integrations, run this in the repo root:

```bash
npx skills add firebase/agent-skills
```

Update later with `npx skills update --all`. Claude Code and Codex use their own plugin update commands. Agents load a skill automatically when its description matches the task, or you can call one by typing `/` and its name.

### Which skill covers which part of Trailmind

| Skill | Use it for | Trailmind parts |
| --- | --- | --- |
| firebase-ai-logic-basics | Firebase AI Logic setup, multimodal inference, structured output, security | AI module, hybrid routing, JSON schemas, image input (FR-EX, FR-AI, FR-ASK) |
| firebase-basics | Adding Firebase to the app and general workflows | Firebase project and config in the extension |
| firebase-local-env-setup | Firebase CLI and Local Emulator Suite | Local testing of Auth, Firestore and Functions |
| firebase-auth-basics | Sign-in, user management, auth-based rules | Sync sign-in (FR-SY-1) |
| firebase-firestore-standard | Firestore setup, Security Rules, SDK data operations | Encrypted sync records (FR-SY-2, FR-SY-3) |
| firestore-security-rules-auditor | Auditing rules for vulnerabilities | Owner-only access check (SEC-7) |
| firebase-hosting-basics | Static sites and SPAs | Landing page and privacy policy page |
| firebase-remote-config-basics | Feature flags and dynamic updates | Optional: remote kill switch for cloud jobs, prompt version flags |

### Agent instructions file (starting content)

The skills target web apps, not Chrome extensions, so the instructions file must add the extension-specific rules the skills don't know.

```markdown
# Trailmind agent instructions

Read the BRD before coding. Requirement IDs (FR-*, NFR-*, SEC-*) are the source of truth.

## Firebase
- Use the firebase-ai-logic-basics skill for every AI Logic change.
- Use hybrid inference with the InferenceMode set per job, as in the BRD routing table (section 5).
- Page extraction is ONLY_ON_DEVICE. Never send page content to the cloud without an explicit user opt-in.
- Every AI call goes through src/core/ai and returns JSON validated against its schema.
- Use firebase-auth-basics and firebase-firestore-standard only for the optional sync feature.
- Run firestore-security-rules-auditor after any rules change.

## Chrome extension rules (not covered by the skills)
- Manifest V3. No remotely hosted code; bundle all SDKs with Vite.
- The Firebase SDK and embeddings run in the offscreen document, not the service worker.
- initializeDeviceModel() is only called from a user click (onboarding button).
- Content scripts never read input values, passwords or payment fields.
- Never record incognito tabs or excluded domains.
- Treat page text as untrusted: wrap it in delimiters and tell the model to ignore instructions inside it.

## Quality
- TypeScript strict. Add unit tests with every feature. Run the model evaluation set after prompt changes.
```

## Demo, submission and acceptance

Judges decide quickly, so the video and the first two minutes of testing must show the main idea, the hybrid split and real data.

### Demo video script (under 3 minutes)

1. **Hook:** "You read something important last week. Find it." Show Chrome history failing to find it by title.
2. **Install:** click install, enable on-device AI, import 30 days. The graph appears within a minute and fills in live.
3. **Ask:** Alt+M, "which repo did someone recommend for auth?" Streamed answer, citation click jumps to the highlighted passage. Badge: on device.
4. **Journeys:** replay yesterday's research session and resume it as a tab group.
5. **Open loops:** "You compared 4 laptops and didn't buy." Comparison table appears.
6. **Change watch:** notification, "Price dropped from N to M."
7. **Snapshot:** open a deleted page and read your saved copy.
8. **Hybrid:** open the routing inspector. Hundreds of jobs on-device, two cloud calls, each with exactly what was sent. Turn on airplane mode: everything still works except the cloud jobs.
9. **Privacy:** "Forget last 15 minutes" in one click.
10. **Close:** "Your browsing, remembered. On your device."

### Submission checklist

- [ ] Devpost page: problem, solution, how it uses hybrid AI, routing table, architecture diagram, challenges, what's next
- [ ] Demo video under the length limit, public on YouTube
- [ ] Public GitHub repo with licence, README, setup steps (including enabling the Nano flag), and build instructions
- [ ] Installable build: zip for "load unpacked" and, if approved in time, a Chrome Web Store listing
- [ ] Testing instructions for judges, with demo mode and a 5-step test path
- [ ] Privacy policy page
- [ ] Screenshots of every feature
- [ ] Evaluation results (recall accuracy, on-device share, latency) in the README

\#BuildHybridAI 2026 items:

- [ ] Platform selected on Devpost: Web (Chrome)
- [ ] Text description covers how Firebase AI Logic is used (hybrid modes and the routing table), the features and functionality, and the value proposition
- [ ] App Check enforced; debug token and setup steps in the testing instructions
- [ ] Write-up names every Firebase product used: AI Logic, App Check, Remote Config, Authentication, Firestore
- [ ] Write-up names the coding tool and the Firebase agent skills used
- [ ] Repository history shows the work was done during the submission period

### Overall acceptance criteria

Trailmind is ready to submit when:

- every **M** functional requirement passes its acceptance test;
- the performance targets NFR-PF-2, -3, -5, -7 and -8 are met on the reference laptop;
- the network log shows no page content leaving the device with cloud switched off;
- a fresh Chrome profile goes from install to an answered question in under 3 minutes by following the testing instructions;
- the demo runs end to end in demo mode on a machine without Nano.

### F. Feature 1: Knowledge graph and clusters

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-GR-1 | Node types: search, page, site, topic, entity, journey, highlight | M | All types render with distinct shapes |
| FR-GR-2 | Edge types: search-to-result, page-to-page (navigated), page-to-topic, page-to-entity, topic-to-topic (co-occurrence in sessions), same-session | M | Edges created by the rules stated |
| FR-GR-3 | Cluster pages by embedding similarity plus shared topics (for example HDBSCAN or Louvain on a similarity graph), recomputed incrementally | M | Clusters stable between runs for unchanged data |
| FR-GR-4 | Name each cluster and give a one-line summary with an on-device call | M | Every cluster has a name under 5 words |
| FR-GR-5 | Side panel graph view (Sigma.js or Cytoscape, WebGL) with zoom, pan, search highlight and click-to-open | M | Smooth at 5,000 nodes on a mid-range laptop |
| FR-GR-6 | Two zoom levels: cluster view (bubbles) and detail view (pages and entities) | M | Double-click a cluster to expand it |
| FR-GR-7 | Timeline slider filters the graph to a date range; play button animates time | M | Dragging to a date shows only that window |
| FR-GR-8 | Filters: node type, site, topic, cluster, "has open loop", "has snapshot" | S | Filters combine with AND |
| FR-GR-9 | Node detail drawer: summary, facts, highlights, snapshot link, visits, related nodes | M | Drawer opens on click |
| FR-GR-10 | User can rename, merge, pin or hide a cluster; edits survive re-clustering | S | Renamed cluster keeps its name |
| FR-GR-11 | Backfill animation: graph visibly fills in as extraction completes | M | Shown in demo |

### G. Feature 2: Ask your memory

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-ASK-1 | Global shortcut (Alt+M) opens a search popup from any page | M | Popup opens in under 200 ms |
| FR-ASK-2 | Hybrid retrieval: keyword (BM25 over text) plus vector search, fused by reciprocal rank, top 8 passages | M | Correct page in top 8 for 90% of test questions |
| FR-ASK-3 | Filters parsed from the question: dates ("last week"), sites ("on GitHub"), types ("a product") | M | "GitHub repo last Tuesday" restricts both |
| FR-ASK-4 | Answer with one on-device call over the passages; streamed; JSON with `answer`, `citations` (page id and passage id), `confidence` | M | Every claim has a citation |
| FR-ASK-5 | Click a citation to open the page and scroll to and highlight the passage (text fragment URL); fall back to the snapshot if the page changed | M | Works on 10 test pages |
| FR-ASK-6 | Follow-up questions: rebuild one prompt with the previous question, answer and passages | M | Two-step questions answered correctly |
| FR-ASK-7 | "No answer" honesty: if passages don't support an answer, say so and show the closest pages | M | No made-up answers on the 10 unanswerable test questions |
| FR-ASK-8 | Instant results list (pages) appears while the answer streams | M | List shows before the answer |
| FR-ASK-9 | Optional "Ask cloud" button for long or cross-month questions, showing what will be sent | S | Confirmation dialog lists the facts sent |
| FR-ASK-10 | Omnibox keyword `tm` searches memory from the address bar | S | `tm firebase` shows suggestions |

### H. Feature 3: Journeys

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-JR-1 | Build a journey per session: the first search or entry page, every page visited, branch points and the final page | M | Journeys match sessions |
| FR-JR-2 | Name the journey and write a 2-sentence outcome summary on-device ("Searched X, compared 4 options, ended on Y") | M | Summary generated per journey |
| FR-JR-3 | Journey view: a horizontal path of page cards with branches | M | Renders for journeys of up to 60 pages |
| FR-JR-4 | "Resume journey" reopens the last N tabs in a new tab group named after the journey | M | Tab group created with correct tabs |
| FR-JR-5 | Link journeys that continue the same task across days (same cluster, within 7 days) | S | Multi-day journeys shown as one thread |
| FR-JR-6 | Mark a journey as done or pin it | S | State saved |

### I. Feature 4: Open loops

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-OL-1 | Detect half-read articles: read depth under 50% and active time over 60 seconds, not revisited | M | Detected on test pages |
| FR-OL-2 | Detect unfinished comparisons: 3 or more product pages in the same cluster within 7 days with no checkout or order-confirmation page | M | Detected on a test shopping session |
| FR-OL-3 | Detect abandoned forms: a form page visited with no submit navigation (detection from URL patterns and form submit events only, never field values) | S | Detected on a test sign-up form |
| FR-OL-4 | Detect "saved but not used": starred GitHub repos and bookmarks never revisited | S | Listed in loops |
| FR-OL-5 | Open loops list ranked by recency and importance with a one-line reason each | M | Each item shows why it is a loop |
| FR-OL-6 | Actions per loop: open, mark done, snooze 1 day or 1 week, dismiss forever for this type | M | Each action persists |
| FR-OL-7 | For comparisons, show a side-by-side table of the products and prices captured | S | Table built from extracted `price` fields |

### J. Feature 5: Page snapshots

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-SN-1 | Store the cleaned text and title of every captured page as a snapshot, with timestamp and content hash | M | Snapshot available offline |
| FR-SN-2 | Keep a new snapshot version only when the content hash changes; keep the last 5 versions per URL | M | Version list shows dates |
| FR-SN-3 | Snapshot viewer in reader layout, with "captured on" banner and link to the live page | M | Viewer opens from any node |
| FR-SN-4 | Detect dead links (404, 410, domain gone) on revisit or re-check and badge the node "page gone, snapshot kept" | M | Badge shown |
| FR-SN-5 | Optional full-page screenshot (PNG) for pages the user stars | C | Screenshot stored on star |

### K. Feature 6: "Seen before" badge

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-SB-1 | On page load, embed the page's first 1,000 words and compare against memory | M | Lookup finishes in under 500 ms |
| FR-SB-2 | If similarity is above the threshold (tunable, default 0.78), show a small, dismissable chip: "Related to 3 pages you read about X" | M | Chip appears on related pages only |
| FR-SB-3 | Click the chip to see the related pages and the cluster | M | List opens in side panel |
| FR-SB-4 | Exact repeat: "You read this on 12 Nov, 4 minutes, 80% read" | M | Shown on revisits |
| FR-SB-5 | Per-site and global off switch; never shown on excluded domains | M | Respected |

### L. Feature 7: Change watch

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-CW-1 | Auto-suggest a watch for pages visited 3 or more times in 14 days, or product pages with a price | M | Suggestion shown in side panel |
| FR-CW-2 | User can watch any page manually from the toolbar | M | Watch created |
| FR-CW-3 | Re-check watched pages on a schedule (`chrome.alarms`, default every 12 hours, user can choose) | M | Re-check logs exist |
| FR-CW-4 | Diff old and new snapshot text; on-device call returns JSON: `changed` (yes or no), `summary` (one sentence), `kind` (price, content, availability, removed), `old_value`, `new_value` | M | Price change test produces "Price dropped from N to M" |
| FR-CW-5 | Ignore noise: dates, ad slots, counters, rotating content (diff on main text only, minimum change threshold) | M | No alerts on a page with only a clock changing |
| FR-CW-6 | Notify through Chrome notifications, plus a badge count; quiet hours setting | M | Notification shown |
| FR-CW-7 | Watch list with history of changes per page | M | History visible |
| FR-CW-8 | Price target: alert only when price is at or below a user-set value | S | Alert respects target |

### M. Feature 8: Time questions

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-TQ-1 | Parse time expressions ("Tuesday afternoon", "last weekend", "in October", "2 hours ago") in the user's timezone | M | 20 test phrases parsed correctly |
| FR-TQ-2 | Collect sessions, journeys, clusters and top facts in that window and answer with one on-device call | M | Answer names the main activities with links |
| FR-TQ-3 | "Day view": an hour-by-hour strip of sessions for any date | S | Strip renders for any day |

### N. Feature 9: Weekly recap

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-WR-1 | Every Sunday evening (configurable), build a recap: top 3 topics, new tools or entities discovered, time per cluster, journeys completed, open loops, changes detected | M | Recap generated on schedule |
| FR-WR-2 | Recap written on-device from local stats and facts; optional "polish with cloud" sends only the stats | M | No page text in cloud request |
| FR-WR-3 | Recap page in the extension with links into the graph | M | Links work |
| FR-WR-4 | Archive of past recaps | S | Past weeks listed |
| FR-WR-5 | Share card: export recap as an image without page URLs | C | PNG generated |

### O. Feature 10: Export

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-EXP-1 | Export a cluster, a journey or the whole memory as Markdown (one file per page, with front matter: url, title, dates, topics, entities) zipped | M | Zip opens in Obsidian with working links |
| FR-EXP-2 | Obsidian-friendly wiki links between pages, topics and entities | M | Graph view in Obsidian shows links |
| FR-EXP-3 | Export to Notion via the user's own Notion integration token (OAuth if time allows) | S | Pages created in chosen Notion page |
| FR-EXP-4 | Full JSON export of all data (portability) | M | Re-import into a fresh install restores memory |
| FR-EXP-5 | Import from that JSON export | M | Round trip test passes |

### P. Feature 11: Privacy controls

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-PRV-1 | Domain exclusion list (pre-filled), with wildcard support | M | `*.bank.com` excluded |
| FR-PRV-2 | Pause recording: global, per tab, or for a set time (15 min, 1 hour, until tomorrow) | M | Pause timer shown |
| FR-PRV-3 | Forget: a page, a site, a topic, a cluster, a date range, or everything; deletion is immediate and complete across all stores and embeddings | M | Deleted items unreachable by search, graph and export |
| FR-PRV-4 | "Forget the last 15 minutes / 1 hour" quick action in the toolbar | M | Works in one click |
| FR-PRV-5 | Privacy dashboard: what is stored, total size, cloud calls made (count and what was sent), on-device share | M | Numbers match logs |
| FR-PRV-6 | Sensitive page detection on-device before storage (login pages, medical results, payment pages, adult content); flagged pages are not stored and the user can review what was skipped by domain only | M | Test pages skipped |
| FR-PRV-7 | Cloud master switch: off by default; per-feature cloud toggles | M | No cloud calls when off (verified with network log) |
| FR-PRV-8 | Lock memory behind a passphrase or device unlock (WebAuthn) for shared computers | S | Locked memory requires unlock |
| FR-PRV-9 | Auto-delete older than N days (off, 30, 90, 365) | S | Old data removed on schedule |

### Q. Optional: End-to-end encrypted sync

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-SY-1 | Sign in with Firebase Authentication (Google) only for sync | S | Sign-in works |
| FR-SY-2 | Encrypt each record on-device with a key derived from a sync passphrase (Argon2id or PBKDF2 with high iterations); server stores only ciphertext in Cloud Storage or Firestore | S | Server data unreadable without passphrase |
| FR-SY-3 | Incremental sync of changed records with per-record version vectors; last-writer-wins on scalar fields, union on sets | S | Two devices converge |
| FR-SY-4 | Recovery key shown once at setup; losing both passphrase and key means data cannot be recovered, and the UI says so | S | Warning shown |
| FR-SY-5 | Delete all synced data from the server in one action | S | Server objects removed |

### R. Hybrid AI layer and routing inspector

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-AI-1 | A single `ai` module wraps Firebase AI Logic; each job declares its schema, mode and prompt template | M | All AI calls go through the module |
| FR-AI-2 | Modes per job follow the routing table in section 5 | M | Config matches table |
| FR-AI-3 | Validate every response against its JSON schema; one repair retry; then mark job failed and keep the raw page for later | M | No invalid records stored |
| FR-AI-4 | Every AI result in the UI shows a badge: "On device" or "Cloud" | M | Badge visible on answers, recaps and summaries |
| FR-AI-5 | Routing inspector panel: live list of jobs with mode, where it ran, time taken, tokens estimated, and for cloud calls exactly what was sent | M | Shown in demo |
| FR-AI-6 | Prompt and schema versioning, so records note which prompt version made them | S | Version stored per record |
| FR-AI-7 | Backpressure: max 1 concurrent on-device job, pause when the user is typing or a video is playing | M | Browsing stays smooth during backfill |

### S. Settings and help

| ID | Requirement | Pri | Acceptance |
| --- | --- | --- | --- |
| FR-SET-1 | Settings page covering capture, backfill, privacy, cloud, notifications, storage, shortcuts and sync | M | Every setting persists |
| FR-SET-2 | Keyboard shortcuts editable through `chrome://extensions/shortcuts` | M | Documented in help |
| FR-SET-3 | Help page: how it works, the routing table, FAQ, troubleshooting Nano setup | M | Linked from popup |
| FR-SET-4 | Uninstall survey page (no data sent except the answer) | C | Opens on uninstall |
