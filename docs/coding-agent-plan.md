# English Vocabulary App — Engineering Plan & Coding Agent Brief

**Role:** Senior software engineer, technical lead, and implementation partner  
**Product stage:** MVP / private pilot  
**Primary objective:** Ship a usable, secure, mobile-friendly English vocabulary learning app and test it with real students.  
**Development approach:** Small vertical slices, test-driven where practical, frequent commits, and no unnecessary complexity.

---

## 1. Your mission

You are the senior engineer responsible for helping me build and release this product.

Do not simply generate code from a broad idea. First understand the requirements, identify risks, make sensible technical decisions, and then implement the product incrementally.

You must optimize for five outcomes:

1. **Learning effectiveness:** Users can recall words after time has passed, not merely recognize the correct answer immediately.
2. **Engagement:** Learning feels rewarding, and users have a reason to return voluntarily.
3. **Simplicity:** The first release solves one important problem exceptionally well.
4. **Reliability and security:** User progress is persistent, private, validated, and recoverable.
5. **Maintainability:** The codebase remains understandable and extensible as the product grows.

Do not overengineer. Do not add features because they sound impressive. Do not claim something is complete unless it has been implemented and verified.

I have a limited development budget and want to ship. Every feature must justify its cost.

## 2. Product vision

The app helps Russian-speaking learners, initially in Kyrgyzstan, learn and retain useful English vocabulary through:

- Curated, high-utility vocabulary.
- Spaced repetition.
- Active recall and spelling practice.
- Short, varied exercises.
- Visible progress and achievable goals.
- Eventually, friendly competitions between classmates and schools.

The long-term vision may include thousands of words, teacher-created groups, leaderboards, weekly competitions, and paid courses.

**These long-term ideas are not all MVP requirements.**

Our initial hypothesis is that students will learn more consistently when evidence-based practice is combined with a satisfying game loop and social accountability.

We must test this hypothesis rather than assume it is true.

## 3. Target user and initial validation

The initial user is a student who wants to improve their English vocabulary but struggles to study consistently or remember words over time.

The first release should be suitable for a small pilot with real students. Avoid designing for every age, language, proficiency level, and country simultaneously.

Assume Russian may be the learner's explanation language, while English is the language being learned. Make language configuration possible without building a complex internationalization system prematurely.

Before implementing major features, identify the assumptions that need validation:

- Are the words useful to the students?
- Do students understand the exercises without assistance?
- Can students complete a short session easily on a phone?
- Do they return without being personally reminded?
- Do they remember words after one or seven days?
- Would teachers or students pay for additional content or competitions?

Do not build expensive features to answer questions that a small prototype or conversation could answer.

## 4. MVP scope

### P0 — Required for the first usable release

**A. Account and persistence**

- Users can register, sign in, and sign out.
- Learning progress persists between sessions and devices.
- Users cannot access another user's private progress.
- Authentication and session handling use a reputable, maintained solution rather than custom password cryptography.
- If an authenticated backend is not ready, use a clearly isolated prototype first; do not mistake local-only storage for a multi-device product.

**B. Vocabulary content**

- Start with approximately 100–200 carefully curated English words.
- Each word should have:
  - English headword.
  - Russian translation or concise meaning.
  - Part of speech where useful.
  - A natural English example sentence.
  - Translation of the example when useful.
  - Optional pronunciation or image metadata, if reliable assets are available.
  - A stable content identifier.
- Support multiple decks or topics, but begin with one polished starter deck.
- Store vocabulary as structured, version-controlled data or in the database with a documented import process.
- Validate duplicate identifiers, missing translations, malformed content, and broken references.
- Do not claim that a specific word list covers a fixed percentage of everyday English unless that claim has been substantiated.

**C. Learning session**

A learner can:

1. Open a deck.
2. Learn a small batch of new words.
3. Attempt to recall their meanings before seeing the answer.
4. Answer a multiple-choice question.
5. Type a word or its meaning where appropriate.
6. Receive immediate, helpful feedback.
7. Review previously learned words.
8. See a session summary.

Keep sessions short, mobile-friendly, and easy to resume.

**D. Spaced repetition**

- Store when each word was introduced and last reviewed.
- Store the learner's review outcome and next scheduled review.
- Prioritize due reviews without neglecting new material.
- Repeatedly incorrect words should return sooner.
- Correctly recalled words should gradually receive longer review intervals.
- Make the scheduling logic deterministic, documented, and unit-tested.
- Separate the scheduling algorithm from UI components and API handlers.

Start with a simple, explainable algorithm. Do not implement an elaborate memory model before the basic learning loop has been validated.

**E. Progress**

Show useful, honest information:

- Words introduced.
- Words currently being reviewed.
- Due reviews.
- Recent practice activity.
- Correct-answer rate, clearly labeled.
- A simple daily goal or weekly progress indicator.

Do not equate total correct clicks with durable learning. A word answered correctly moments after being shown is weaker evidence of learning than a word recalled several days later.

**F. Basic gamification**

- Points for completing meaningful learning activities.
- A progress indicator.
- A modest daily goal.
- Encouraging feedback for consistency.
- A completion screen that gives users a clear next step.

Keep rewards subordinate to learning. Do not reward endless guessing, repeated trivial sessions, or activity that inflates metrics without improving retention.

**G. Responsive interface**

- Mobile-first design.
- Works on common phone and desktop screen sizes.
- Clear typography and readable cards.
- Keyboard support where appropriate.
- Visible focus states, accessible controls, and sufficient color contrast.
- Helpful loading, empty, success, and error states.

The product should feel polished enough that a student can use it without a developer explaining how it works.

### P1 — Only after the core loop works

- Private groups created by a teacher.
- Weekly challenges within a group.
- Basic group progress and a small leaderboard.
- Invitations through shareable links with appropriate access controls.
- A teacher view to see participation and learning progress.
- Additional curated decks.

### Explicitly out of scope for the first release

Do not implement these without explicit approval:

- Thousands of words at once.
- Public global or regional leaderboards.
- Real-time multiplayer competitions.
- Native iOS and Android applications.
- AI-generated lessons or personalized AI tutors.
- Complicated subscriptions and payment processing.
- Microservices, Kubernetes, or an event-streaming platform.
- Elasticsearch or a separate analytics warehouse.
- Social feeds, direct messaging, or a broad social network.

A mobile-friendly web application that can later become installable as a PWA is sufficient for the initial release.

## 5. Recommended architecture

Use a modular monolith. Keep the number of technologies and independently deployed services small.

### Frontend

- React.
- TypeScript with strict type checking.
- A maintained, lightweight build tool such as Vite.
- A consistent, accessible component and styling approach.
- A small API client layer.
- Explicit loading, error, and empty states.
- Automated tests for important user interactions.

Avoid unnecessary state-management libraries until the application needs them.

### Backend

- Python.
- FastAPI.
- Pydantic for request and response validation.
- A maintained ORM or query layer.
- Explicit database migrations.
- Structured application logging.
- Automated API and business-logic tests.

### Database

- PostgreSQL for durable user and learning data.
- Database constraints for data integrity.
- Transactions where multiple changes must succeed together.
- Indexes based on actual access patterns.
- A documented migration and backup strategy.

Use a reputable managed PostgreSQL and authentication provider where practical. Before selecting a provider, verify its pricing, regional availability, data-export options, authentication capabilities, and deployment compatibility.

Do not introduce a separate database abstraction or service merely for theoretical future scale.

### Suggested logical modules

1. Authentication and user profile.
2. Vocabulary and deck management.
3. Learning sessions and answer evaluation.
4. Review scheduling.
5. Progress and statistics.
6. Gamification.
7. Analytics.
8. Administration and content validation.

These are logical boundaries, not necessarily separate services or packages on day one.

### Suggested repository structure

Adapt this to the existing repository rather than replacing working files unnecessarily.

```text
vocabulary-app/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── vocabulary/
│   │   │   ├── learning/
│   │   │   └── progress/
│   │   ├── lib/
│   │   └── pages/
│   └── tests/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   └── tests/
├── content/
│   └── starter-deck/
├── docs/
│   ├── product-requirements.md
│   ├── architecture.md
│   └── decisions/
├── .github/
│   └── workflows/
├── .env.example
├── .gitignore
└── README.md
```

This is a proposed starting point, not a requirement to create every directory immediately.

## 6. Core data model

Design the data model around the learning process, not around individual screens.

At minimum, consider these entities:

**User**
- Stable identifier.
- Authentication-provider identifier or relationship.
- Creation timestamp.
- Minimal preferences.

**Deck**
- Stable identifier.
- Title, description, and language configuration.
- Publication status.
- Content version.

**Word**
- Stable identifier.
- Headword and linguistic metadata.
- Meanings and examples.
- Content version and validation status.

**DeckWord**
- Relationship between a deck and a word.
- Optional ordering or curriculum metadata.

**UserWordProgress**
- User identifier and word identifier.
- Learning status.
- Introduction timestamp.
- Last review timestamp.
- Next scheduled review timestamp.
- Relevant counters and scheduling state.

Enforce one progress record per user and word unless there is a deliberate reason to support multiple learning contexts.

**ReviewAttempt**
- User and word identifiers.
- Timestamp.
- Exercise type.
- Whether the answer was correct.
- Relevant scheduling outcome.
- Session identifier where useful.

Keep attempt records minimal. Do not store unnecessary free-text answers or personal information.

**LearningSession**
- User identifier.
- Start and completion timestamps.
- Session outcome and summary.

You may adjust this model after identifying concrete requirements. Document important decisions and their trade-offs.

Avoid adding a table for every possible future feature.

## 7. Learning and review rules

Implement these rules in a dedicated, tested service.

1. New words are introduced in manageable batches.
2. Learners attempt recall before the answer is revealed.
3. Exercises vary between recognition and production.
4. Correct answers update review scheduling.
5. Incorrect answers lead to feedback and an appropriately earlier review.
6. A learner can leave a session without losing previously saved progress.
7. Review scheduling is consistent across devices and sessions.
8. Repeated submissions must not accidentally award duplicate points or corrupt review state.
9. The UI must distinguish a newly introduced word from a word recalled after a delay.

Choose and document an initial scheduling algorithm. The exact intervals are hypotheses to validate, not scientifically guaranteed constants.

Test at least these cases:

- First exposure to a word.
- Correct first review.
- Incorrect review.
- Repeated incorrect reviews.
- Increasing intervals after successful reviews.
- Review due at the current time.
- Time-zone and daylight-saving boundaries.
- Duplicate submission of an answer.
- Concurrent updates from multiple devices.

Do not describe a word as permanently mastered. Use a clear, provisional concept such as “currently well learned,” with its definition documented.

## 8. Security, privacy, and reliability

Security is part of implementation, not a final cleanup task.

### Authentication and authorization

- Use established authentication libraries or a trusted provider.
- Enforce authorization on the server for every user-owned resource.
- Never trust a user identifier supplied by the client as proof of ownership.
- Prevent insecure direct object reference vulnerabilities.
- Keep administrative permissions separate from ordinary user permissions.

### Input and API security

- Validate all external inputs.
- Use parameterized queries or safe ORM operations.
- Enforce sensible payload sizes and request limits.
- Rate-limit sensitive endpoints such as login and answer submission where appropriate.
- Never rely on frontend validation alone.
- Do not expose stack traces, credentials, internal database details, or sensitive logs to clients.

### Secrets

- Keep secrets out of source control.
- Provide `.env.example` with placeholder values only.
- Ensure real environment files are ignored by Git.
- Use environment variables or the deployment platform's secret manager.
- If a credential is committed accidentally, treat it as compromised and rotate it.

### Data protection

- Collect only data required for the product.
- Do not introduce unnecessary tracking or third-party advertising SDKs.
- Provide a reasonable account and data-deletion path before public launch.
- Establish backups and verify that restoration works.
- Define appropriate retention for learning-attempt data.
- Be particularly careful with school use and minors. Determine applicable privacy obligations before collecting data from children at scale.

### Reliability

- Use database transactions for learning-state changes.
- Handle network failures and repeated requests safely.
- Display meaningful error messages and allow retries where appropriate.
- Provide health checks and operational logs.
- Test migrations against a disposable or staging database before production.
- Document how to roll back an application deployment and recover from a failed migration.

Do not claim the application is secure simply because it passes automated tests. Tests reduce risk; they do not prove the absence of vulnerabilities.

## 9. Analytics and product validation

Add a minimal first-party analytics layer that answers specific product questions.

Suggested events:

- `account_created`
- `onboarding_completed`
- `learning_session_started`
- `word_introduced`
- `answer_submitted`
- `review_scheduled`
- `delayed_recall_completed`
- `learning_session_completed`
- `group_challenge_completed` — when groups are introduced

Events should have a documented schema, stable identifiers, and a clear definition of when each event fires. Avoid recording sensitive free-text answers.

### Key measures

**Learning**
- Recall accuracy during immediate practice.
- Recall accuracy after a meaningful delay.
- Retention at approximately one day and seven days.
- Spelling and production accuracy.
- Time spent learning.
- Number of reviews required for successful recall.

**Engagement**
- Percentage of new users who complete their first session.
- Voluntary return the following day and week.
- Session completion and abandonment.
- Whether users continue without personal reminders.
- Review burden and the number of overdue reviews.

**Distribution**
- Invites sent and accepted.
- Active learners per teacher-created group.
- Participation in weekly challenges.
- Conversion to paid content, if introduced.

A useful candidate North Star metric is **words correctly recalled after a meaningful delay per active learner per week**. Define the delay and denominator precisely before using this metric.

Treat early numerical targets as hypotheses, not universal benchmarks. Establish a baseline with the pilot and use the data to decide what to improve.

## 10. Implementation sequence

Build one complete, testable vertical slice at a time.

### Phase 0 — Inspect and plan

Before writing application code:

1. Inspect the repository, Git history, existing files, and development environment.
2. Identify the current state of the project.
3. Confirm the frontend, backend, database, authentication, and deployment choices.
4. Identify missing decisions and external dependencies.
5. Write or update `docs/product-requirements.md` and `docs/architecture.md`.
6. Provide a concise implementation plan with milestones, risks, and acceptance criteria.

Do not overwrite or delete existing work to make the repository match the proposed structure.

### Phase 1 — Running application skeleton

- Set up the frontend and backend.
- Establish local development commands.
- Add configuration validation.
- Add linting, formatting, and type checking.
- Add a basic automated test suite.
- Add CI to run checks on pull requests.
- Create a minimal health endpoint.
- Document setup from a clean checkout.

**Acceptance criteria:** Another developer can clone the repository, follow the README, run the application, and run the tests without guessing missing steps.

### Phase 2 — Vocabulary content and first learning loop

- Create the starter deck.
- Validate and load its content.
- Build the learning-session UI.
- Implement recall and answer feedback.
- Persist the session and answer results.
- Add tests for the learning service and key UI states.

**Acceptance criteria:** A learner can open a deck, learn a word, answer questions, receive feedback, complete a session, and see their progress after refreshing the application.

### Phase 3 — Spaced repetition and progress

- Implement and test the review scheduler.
- Add due-review selection.
- Persist progress across sessions and devices.
- Add the progress dashboard.
- Test repeated requests and concurrent state changes.

**Acceptance criteria:** A word reviewed today receives a consistent next-review schedule, and the same learner sees consistent progress on another device.

### Phase 4 — Accounts and deployment

- Integrate authentication.
- Enforce server-side resource authorization.
- Configure production secrets and environment settings.
- Deploy a staging version.
- Run end-to-end smoke tests.
- Verify backups and restore procedures.
- Deploy the initial release.

**Acceptance criteria:** A real user can sign up, learn, return later on another device, and see their saved progress without accessing another user's data.

### Phase 5 — Private pilot

- Recruit a small group of real learners.
- Observe users completing the first session.
- Collect usability feedback.
- Measure voluntary return and delayed recall.
- Identify confusing exercises and content errors.
- Fix the most consequential issues before adding features.

**Acceptance criteria:** We have actual evidence about usability, retention, and learner interest—not just a working demo.

### Phase 6 — Decide what to build next

Use pilot results to choose between improving the learning loop, expanding vocabulary, adding teacher groups, or testing paid content.

Do not start a leaderboard or payment system simply because it was in the original vision.

## 11. Testing requirements

Use a testing pyramid.

**Unit tests**
- Review scheduling.
- Answer evaluation.
- Point calculations.
- Content validation.
- Progress calculations.
- Authorization and business rules.

**Integration tests**
- API endpoints.
- Database persistence.
- Authentication and resource ownership.
- Learning-state updates and transactions.
- Migration behavior.

**End-to-end tests**
- New learner completes a session.
- Learner returns and reviews due words.
- Progress survives a page refresh.
- User A cannot read or change User B's progress.
- Network failure produces a recoverable state.
- Duplicate requests do not duplicate rewards or corrupt progress.

Run the relevant checks after every meaningful implementation step. Run the complete suite before release.

Do not disable a failing test simply to make CI green. Investigate the failure, correct the implementation or test if justified, and explain any unavoidable limitation.

## 12. Engineering standards

Follow these rules throughout the project:

- Use TypeScript strictly and add type hints to Python code.
- Keep business logic out of UI components and HTTP handlers.
- Prefer small modules with clear responsibilities.
- Use database migrations for schema changes.
- Keep API request and response contracts explicit.
- Avoid duplicated scheduling, scoring, and authorization logic.
- Pin or constrain dependencies appropriately and avoid unmaintained packages.
- Keep error handling consistent.
- Do not introduce abstractions without a concrete need.
- Document non-obvious decisions and important trade-offs.
- Use accessible UI patterns.
- Keep the README current.
- Make commits small enough to review and explain.

Never place secrets, private keys, real user records, or production database dumps in GitHub.

## 13. Rules for working as my coding agent

I want you to behave like a strong engineering partner, not an unquestioning code generator.

### Before each milestone

1. State the intended outcome.
2. Identify files or modules likely to change.
3. Identify important assumptions and risks.
4. Break the work into reviewable steps.
5. Define how completion will be verified.

### During implementation

- Inspect existing code before changing it.
- Prefer the smallest complete solution.
- Make changes in coherent, reviewable increments.
- Run relevant tests and static checks.
- Review your own diff for accidental changes, security issues, and unnecessary complexity.
- Do not silently change architecture or scope.
- Ask me when a product decision materially affects user experience, cost, privacy, or long-term compatibility.
- Otherwise, make a reasonable low-risk decision, document it, and proceed.

### After each milestone

Report:

1. What works now.
2. Files created or changed.
3. Tests and commands actually run.
4. Results, including failures.
5. Database migrations or configuration changes.
6. Security and reliability considerations.
7. Known limitations and unfinished work.
8. How I can run and verify the feature.
9. The recommended next step.

Never claim that a feature, test, deployment, migration, or security review succeeded unless you have evidence that it did.

Do not make irreversible production changes, deploy publicly, incur material costs, or alter live data without my explicit approval.

## 14. Definition of done

A feature is not done merely because the code exists.

A feature is done when:

- Its intended user behavior works.
- Relevant tests pass.
- Inputs are validated.
- Authorization is enforced where needed.
- Errors are handled.
- Loading and empty states are implemented where relevant.
- Data persists correctly.
- The code is understandable and maintainable.
- The documentation is updated where necessary.
- The changes have been reviewed.
- Known limitations are disclosed.

The MVP is ready for a private pilot when a learner can sign up, complete a learning session, review words on schedule, track progress, and return from another device—and when the deployment, privacy controls, and core tests are in place.

## 15. Immediate next action

Do not build the entire application in one giant generation.

Start by inspecting the repository and producing the Phase 0 deliverables. Then propose the smallest first vertical slice and wait for my review before making broad changes.

The first vertical slice should demonstrate a complete learning interaction using real starter-deck content. Build the rest incrementally around that working foundation.

Our goal is not to maximize lines of code, features, or architectural sophistication.

**Our goal is to ship a product that real students use, learn from, and choose to return to.**
