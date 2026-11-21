# Trailmind agent instructions

Read the BRD (`Trailmind — Business Requirements Document.md`) before coding. Requirement IDs (`FR-*`, `NFR-*`, `SEC-*`, `DEV-*`) are the source of truth.

## Firebase Agent Skills mapping

Install skills before writing Firebase code:

```bash
npx skills add firebase/agent-skills
```

Update before major milestones with `npx skills update --all`.

| Skill | Use it for | Trailmind parts |
| --- | --- | --- |
| `firebase-ai-logic-basics` | Firebase AI Logic setup, multimodal inference, structured output, security | AI module, hybrid routing, JSON schemas, image input (`src/core/ai`, `FR-EX-*`, `FR-AI-*`, `FR-ASK-*`) |
| `firebase-basics` | Adding Firebase to the app and general workflows | Firebase project and config (`src/core/firebase`) |
| `firebase-local-env-setup` | Firebase CLI and Local Emulator Suite | Local testing of Auth, Firestore and Remote Config |
| `firebase-auth-basics` | Sign-in, user management, auth-based rules | Optional sync sign-in (`FR-FB-5`, `FR-SY-1`) |
| `firebase-firestore-standard` | Firestore setup, Security Rules, SDK data operations | Encrypted backup and sync records (`FR-FB-6`, `FR-SY-2`, `FR-SY-3`) |
| `firestore-security-rules-auditor` | Auditing rules for vulnerabilities | Owner-only access check (`FR-FB-7`, `SEC-7`, `firestore.rules`) |
| `firebase-hosting-basics` | Static sites and SPAs | Landing page, privacy policy, uninstall survey (`site/`) |
| `firebase-remote-config-basics` | Feature flags and dynamic updates | Per-job InferenceMode, cloud model, thresholds, kill switch, prompt templates (`FR-FB-2` to `FR-FB-4`) |

## Firebase rules
- Use the `firebase-ai-logic-basics` skill for every AI Logic change.
- Use hybrid inference with the `InferenceMode` set per job, matching the BRD routing table (section 5).
- Page extraction and sensitive-page detection are `ONLY_ON_DEVICE`. Never send raw page content to the cloud without an explicit user opt-in.
- Every AI call goes through `src/core/ai` and returns JSON validated against its Zod schema with a single repair retry.
- Enforce Firebase App Check on every AI Logic call (debug token supported for judges).
- Use `firebase-auth-basics` and `firebase-firestore-standard` only for the optional encrypted backup and sync features.
- Audit `firestore.rules` with `firestore-security-rules-auditor` after any rules change.

## Chrome extension rules (not covered by the skills)
- Manifest V3. No remotely hosted code; bundle all SDKs with Vite.
- The Firebase SDK and local embeddings run in the offscreen document (`src/entrypoints/offscreen`), not the service worker.
- `initializeDeviceModel()` is only called from a user click (onboarding button).
- Content scripts never read `input.value`, `textarea.value`, passwords, or payment fields.
- Never record incognito tabs, `chrome://` URLs, excluded domains, or pages flagged as sensitive.
- Treat page text as untrusted: wrap it in explicit delimiters and instruct the model to ignore instructions inside it. Render model outputs as text, never raw HTML.
- Background backfill fetches always use `credentials: 'omit'`.

## Quality
- TypeScript strict mode. Core modules (`src/core/*`) stay separate from feature modules (`src/features/*`).
- Add unit tests with every feature and run the model evaluation harness (`npm run eval`) after prompt changes.
