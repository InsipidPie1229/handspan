# Growth plan

Research and plan agreed on 2026-11-08. A small qualitative sample, not a market survey. No revenue or search ranking is claimed.

## Evidence: small qualitative sample, not a market survey

- Korea, Inven, 2020-05-06: existing FPS sensitivity transfer tutorial, with DPI and engine/feel caveats. Older but direct community evidence of the workflow, not proof of current demand volume. https://www.inven.co.kr/board/valorant/5621/54
- Korea, DCInside: user asks whether 0.625 sensitivity at roughly 750–850 DPI is low or high. Supports clearer DPI × sensitivity context; does not justify a universal recommended number. https://gall.dcinside.com/board/view/?id=valorant&no=194908
- International, Reddit FPSAimTrainer, 2025-08-22: complaints about inconsistent converter results, with replies valuing cm/360 and phone/browser access without opening the trainer. https://www.reddit.com/r/FPSAimTrainer/comments/1mx8x9l/sensitivity_converter/
- International, Reddit FPSAimTrainer, 2024-02-08: confusion about ADS vs hipfire matching and FOV. Demand evidence only; comments are not authoritative mathematics. https://www.reddit.com/r/FPSAimTrainer/comments/1alpqxf/question_about_matching_sensitivities/

## Existing solutions preflight

KovaaK's, mouse-sensitivity.com and aiming.pro already offer conversion. A Korean-localized competitor also exposes direct cm/360, target DPI, favorites and sharing: https://sensconverters.com/ko/valorant-overwatch-gamdo-byeonhwangi/ . These are product observations, not independent validation of coefficients. Do not recreate a broad trainer or claim novelty. The user explicitly requests continued custom development of the existing handspan site; differentiate through Korean/English clarity, transparent sources/limitations, fast local-first workflows and verification guidance. No new library/tool is selected.

## Feature batches and acceptance

### Batch A: trust and quick conversion

1. Add cm/360 as a direct input mode, alongside existing game sensitivity input; inverse calculation must use the existing coefficient and rounding contracts. Do not invent new game values.
2. Add save/load named local profiles and an explicit copy-share-link action. Existing URL parameters already serialize conversion state; extend rather than duplicate them. Saved profiles are a product hypothesis from competitor observation, not an explicit request in the sampled community posts.
3. Add a practical real-game 360-degree verification checklist and prominent hipfire-only / FOV / ADS limits. Keep per-game caveats beside results. Do not label all games independently verified.

Acceptance: equivalent sensitivity and cm inputs yield equivalent physical distance within existing rounding; reject zero/negative/nonfinite values; unknown game IDs cannot render unsafe values; shared URLs round-trip across ko/en and the project subpath; profile names render as text; blocked/corrupt/full localStorage does not stop conversion; no secret or unrelated local history appears in shared links. Verify phone and keyboard workflows. Browser tests must be reported separately from numerical unit tests.

### Batch B: search-intent pages

Start with a few useful routes such as VALORANT↔CS2, each with static localized examples, supported conversion scope, formula, source dates, assumptions and a clear path to the working calculator. No mass-generated game permutations with only swapped titles. Avoid fake in-game validation and universal "best sensitivity" claims. Preserve existing canonical/hreflang/OG/sitemap rather than describing them as newly implemented. All generated links and assets must work under /handspan/.

### Later, after evidence

Local A/B sensitivity comparison with context and sample counts; optional export/import; ADS/FOV matching only with game-specific primary evidence and tests. Do not copy forum formulas into production. No mouse-latency/polling claims from browser timing alone. No leaderboard before abuse/privacy/backend costs have a justified design.

## SEO and AI search

Google says ordinary SEO fundamentals apply to AI Overviews/AI Mode; no special AI files or schema are required, and indexing/inclusion is not guaranteed: https://developers.google.com/search/docs/appearance/ai-features

Implement/verify: useful textual HTML, unique descriptive titles, internal navigation, correct canonical and hreflang, actual public URL in sitemap, HTTPS/200 assets, accessible mobile performance, visible source and update dates. Structured data must describe visible content truthfully; it does not guarantee a rich result. Do not prioritize llms.txt over real content.

Google essentials: https://developers.google.com/search/docs/essentials

Naver requires host-level registration/verification, not project-subpath-only registration. Thus /handspan/ cannot simply be registered as its own host; verify control of insipidpie1229.github.io root or later use an independently controlled hostname. Do not overwrite another project's root to do this. https://searchadvisor.naver.com/guide/seo-basic-intro

Crawler controls are host-root scoped. A robots.txt generated only at /handspan/robots.txt is not the origin robots.txt. Check the actual origin before claiming crawler configuration works. A missing robots file does not by itself block crawling. Search Console/Naver submission needs an authenticated owned account; if unavailable, report submission as pending without blocking development or public hosting. No indexing/ranking guarantee.

Launch measurement: verify endpoint health, then separate search impressions, clicks/CTR and useful query coverage when authorized dashboards are accessible. Do not equate GitHub stars, search-index count or AI citations with revenue. Existing no-analytics privacy copy remains true until an explicit, reviewed measurement change is made.

## Monetization decision proposal

Keep conversion and practice free. First evaluate voluntary support with the user's real account/link, then disclosed equipment affiliate links or directly negotiated sponsorship after traffic evidence. These require the actual receiving/affiliate accounts and contracts; never invent links or enroll the user silently. Advertising is a later experiment, not a launch blocker; assess mobile performance, consent/privacy implications and actual net earnings before rollout. Do not publish guessed income projections as results.

GitHub's official terms allow some donation/crowdfunding uses but prohibit using Pages to run an online business or commercial SaaS. A payment-driven service or commercial product needs a hosting arrangement whose terms permit it, separately from the public GitHub repository. Do not assume blanket permission for an ad/affiliate business on Pages. https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features

Revenue model: disclosed affiliate revenue = eligible clicks × observed conversion × actual commission; ads = actual monetizable impressions / 1000 × observed net RPM; support = actual donations minus fees. Values currently unmeasured. Product success first means useful conversions and return use, not installed ads.
