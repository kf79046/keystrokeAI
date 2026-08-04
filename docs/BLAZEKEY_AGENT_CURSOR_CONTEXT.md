# BlazeKey Holistic Product Engineering Agent
## Cursor Context, Architecture, Branch Plan, Safety Model, and Implementation Roadmap

**Project:** BlazeKey
**Primary objective:** Build a product-specific AI engineering system on top of BlazeKey that can investigate product problems, run deterministic audits, propose scoped fixes, create validated implementation branches and draft pull requests, and eventually discover high-value work when the approved queue is empty.

**Secondary objective:** Use this project as a flagship AI engineering portfolio project for a post-graduation career transition into AI engineering.

**Important framing:** This is not an attempt to rebuild Cursor as a general-purpose coding IDE. Cursor remains a development tool. The system being built here is a **BlazeKey-specific product engineering agent** with product knowledge, deterministic quality checks, user-behavior context, human approval boundaries, and outcome measurement.

**Document status:** Roadmap and future-state design, reconciled with the repository at `main` commit `3c91fc0` on 2026-08-03. Statements labeled as phases, proposed types, desired schemas, or future tools are not current implementation claims. Current-state details are maintained in:

- `docs/current-architecture.md`
- `docs/adaptive-test-flow.md`
- `docs/settings-flow.md`

---

# 1. Product Context

BlazeKey is an existing typing platform rather than a greenfield AI demo. It already has meaningful product and engineering surface area:

- Next.js and TypeScript application
- FastAPI authentication service backed by PostgreSQL
- Firestore-backed runs, totals, stats, leaderboard/profile projections, and party records
- PartyKit-based multiplayer functionality
- Username/password authentication with JWT session cookies
- Typing tests and test results
- Adaptive test behavior
- Per-user typing performance data
- Keystroke-level or pattern-level analysis
- Custom text support
- AI-generated or AI-assisted feedback
- Analytics and product usage data
- Deployed application and real users
- Existing UI, settings, and responsive behavior that need improvement
- Existing growth, retention, and marketing needs

The current system is hybrid rather than PostgreSQL-primary. Postgres owns account/auth records, Firestore owns most game and product data, and PartyKit room storage owns live multiplayer room state. The active solo prompt path runs in Next.js/TypeScript; FastAPI's Python generator is a parallel path, not the browser's current solo-generation boundary.

Current known product issues include:

1. Adaptive test behavior needs significant improvement.
2. The settings experience behind the gear icon is not polished.
3. Existing settings and toggles are not all reliable.
4. User customization and personalization are limited.
5. Punctuation and number filters do not always affect generated tests correctly.
6. Punctuation and numbers may be inconsistently included or excluded.
7. The displayed settings may not always match the effective generation configuration.
8. The typing test is not always positioned consistently on screen.
9. Opening or closing settings may affect layout.
10. Responsive behavior and UI stability need systematic testing.
11. There are likely additional product issues that have not yet been captured in a formal backlog.
12. Work has historically not always been isolated into dedicated branches, making rollback and review harder than necessary.

---

# 2. Long-Term Product Vision

The system should evolve into an evidence-driven product engineering workflow:

```text
Developer instruction, backlog item, test failure, or product signal
                              ↓
                      Structured agent task
                              ↓
                   Evidence collection and audit
                              ↓
                Scoped implementation plan with risks
                              ↓
                       Human plan approval
                              ↓
                 Isolated implementation branch
                              ↓
              Deterministic tests and preview deployment
                              ↓
                    Human review and merge decision
                              ↓
                  Product metric and regression review
                              ↓
              Validated improvement or rollback recommendation
```

The agent must be useful in two modes.

## Directed Mode

The developer explicitly tells the system what needs attention.

Examples:

- Investigate why punctuation settings are inconsistent.
- Improve the settings UI.
- Stabilize the typing test layout.
- Add working personalization controls.
- Improve adaptive test generation.
- Fix a multiplayer rematch problem.

## Discovery Mode

When there is no approved work in the queue, the system may inspect safe evidence sources and propose tasks.

Potential discovery sources:

- Automated test failures
- Adaptive generation audit failures
- Browser layout regressions
- Runtime errors
- Product analytics anomalies
- Settings that are never used
- User flows with high abandonment
- UI controls that do not affect behavior
- Repeated support or feedback themes
- Slow or unreliable endpoints
- PartyKit disconnection patterns
- Accessibility regressions

Discovery Mode may create **proposals**, not silently implement or deploy them.

---

# 3. Core Differentiation

A generic coding agent understands files and instructions.

The BlazeKey Product Engineering Agent must understand:

- BlazeKey product areas
- How typing tests are generated
- How settings flow through the application
- How user preferences are stored
- How adaptive behavior works
- How test results are persisted
- How multiplayer races work
- Which metrics indicate improvement
- Which files are safe to change for a task
- Which changes require explicit approval
- How to determine whether a task was successful
- How to detect regressions after implementation

The main value is not raw code generation. The main value is:

1. Product-specific evidence collection
2. Reliable task scoping
3. Deterministic validation
4. Human-controlled implementation
5. Outcome measurement
6. Traceable agent behavior

---

# 4. Non-Negotiable Engineering Principles

## 4.1 Understand Before Modifying

Before changing a product area, trace the current data flow and document it.

For every major feature, identify:

- Entry UI
- Local state
- Shared state or context
- API boundary
- Validation layer
- Database persistence
- Core business logic
- Rendered result
- Test coverage
- Analytics events

## 4.2 Reproduce Before Fixing

For a bug:

1. Reproduce the issue.
2. Add or identify a failing test.
3. Confirm the failure is meaningful.
4. Make the smallest reasonable fix.
5. Confirm the test passes.
6. Run related regression checks.

## 4.3 One Branch, One Coherent Capability

Do not combine unrelated changes into a single branch.

Examples of separate work:

- Adaptive filter test harness
- Adaptive configuration fix
- Settings persistence
- Settings UI redesign
- Layout regression tests
- Agent database schema
- Read-only planning agent
- Draft PR execution
- Discovery scouts

## 4.4 Human Approval Before High-Impact Actions

The system must not autonomously:

- Merge pull requests
- Deploy to production
- Modify secrets
- Change billing
- Alter authentication
- Perform destructive database migrations
- Drop tables
- Rewrite PartyKit infrastructure
- Delete user data
- Send external marketing messages
- Make irreversible product changes

## 4.5 Deterministic Checks Before Model Judgment

Use normal code and tests for:

- Character inclusion and exclusion
- Configuration validation
- Layout bounds
- API response shape
- Database constraints
- Test result calculations
- State transitions
- Build, lint, and type checks
- Accessibility rules where deterministic tooling exists

Use a model for:

- Summarizing evidence
- Forming hypotheses
- Producing plans
- Explaining tradeoffs
- Suggesting experiments
- Categorizing failures
- Drafting implementation specifications

## 4.6 The Agent Must Record Its Work

Every agent run should record:

- Task
- Input context
- Model used
- Tools called
- Files inspected
- Test outputs
- Plan
- Approvals
- Branch
- Pull request
- Final result
- Errors
- Timing
- Cost where available

## 4.7 No Hidden Scope Expansion

If a task is scoped to adaptive generation, the agent must not opportunistically rewrite authentication, styling infrastructure, database access, or multiplayer systems.

---

# 5. Branching Strategy

The repository should adopt a strict branch workflow before large agent work begins.

## 5.1 General Rules

- `main` should remain deployable.
- Do not perform major work directly on `main`.
- Create a branch before meaningful implementation.
- Branch from the latest reviewed `main`.
- Merge one major capability before starting the next dependent capability.
- Prefer draft pull requests early.
- Use pull request descriptions to record scope, acceptance criteria, checks, and rollback notes.
- Avoid keeping many deeply stacked branches alive at once.
- Small documentation-only changes may be combined when safe.
- Database migrations must be isolated and reversible.

## 5.2 Recommended Branch Naming

```text
docs/<topic>
test/<topic>
fix/<topic>
feat/<topic>
refactor/<topic>
chore/<topic>
```

Examples:

```text
docs/blazekey-agent-context
test/adaptive-quality-harness
fix/adaptive-config-pipeline
feat/settings-schema-persistence
feat/settings-ui-redesign
test/typing-layout-regression
feat/agent-task-schema
feat/agent-audit-runner
feat/agent-readonly-planner
feat/agent-github-control-plane
feat/agent-draft-pr-executor
feat/agent-discovery-scouts
feat/agent-product-metrics
docs/agent-case-study
```

## 5.3 Branch Lifecycle

For each branch:

1. Pull latest `main`.
2. Create a dedicated branch.
3. Confirm the branch scope in a short task document or issue.
4. Implement only the approved scope.
5. Run targeted tests.
6. Run type check, lint, and build; record repository baseline failures separately from branch regressions.
7. Add browser checks where relevant.
8. Open a draft pull request.
9. Review the diff.
10. Record rollback notes.
11. Merge only after acceptance checks pass.
12. Delete the branch after merge.

Example:

```bash
git switch main
git pull --ff-only
git switch -c test/adaptive-quality-harness
```

## 5.4 Rollback Strategy

For every pull request, document:

- What changed
- Which tables or migrations changed
- Which user-visible behavior changed
- Which feature flags exist
- How to disable the change
- Whether reverting the merge commit is sufficient
- Whether data migrations require a down migration
- Whether cached data must be invalidated

For risky features, prefer:

- Feature flags
- Additive schema changes
- Backward-compatible API changes
- Shadow-mode evaluation
- Preview deployments
- Limited rollout
- Explicit kill switches

---

# 6. Master Branch Roadmap

The following branches represent the major implementation phases. Do not implement all of them simultaneously.

---

## PHASE 0 — Repository Understanding and Workflow Foundation

### Branch: `docs/blazekey-agent-context`

Purpose:

- Add this context document to the repository.
- Document the current architecture after inspection.
- Record package manager, test commands, deployment setup, database tooling, and existing conventions.
- Add initial branch and pull request discipline.
- Create a lightweight architecture map.

Deliverables:

- `docs/BLAZEKEY_AGENT_CURSOR_CONTEXT.md`
- `docs/current-architecture.md`
- `docs/adaptive-test-flow.md`
- `docs/settings-flow.md`
- Optional pull request template
- Optional issue templates
- Optional `.cursor/rules` files

Required checks:

- No production behavior changes
- Documentation matches actual repository structure
- Every claimed file or subsystem is verified

Stop condition:

- The developer can explain the typing test request flow.
- The developer can explain the settings flow.
- The developer can explain the Postgres, Firestore, and PartyKit ownership boundaries.
- The developer can identify existing testing tools.

---

## PHASE 1 — Adaptive Test Quality Harness

### Branch: `test/adaptive-quality-harness`

Purpose:

Create deterministic validation for punctuation, numbers, and related generation behavior before attempting a major adaptive refactor.

Core outputs:

- A test-only normalized input/observation shape; do not introduce the Phase 2 production configuration refactor
- Caller-supplied seed support for deterministic local generation only
- Independent generated-test validator
- Test matrix for punctuation and number combinations
- Structured raw-generator and downstream-stage audit output
- Characterization tests for current behavior

Minimum configuration matrix:

```text
punctuation=false, numbers=false
punctuation=true,  numbers=false
punctuation=false, numbers=true
punctuation=true,  numbers=true
```

Potential validation rules:

- Numbers disabled produces zero numeric characters.
- Punctuation disabled produces zero punctuation characters.
- Numbers enabled permits digits; report batch inclusion/density without assuming every sample must contain one.
- Punctuation enabled permits punctuation; report batch inclusion/density without assuming every sample must contain one.
- Generated text is not empty.
- Generated text length is within expected bounds.
- Identical seed and configuration produce identical output only for deterministic local operations.
- Effective configuration matches requested configuration.
- Invalid configuration is rejected before rendering.
- Audit reports include stage, seed, requested/effective configuration, generated text, inclusion metrics, and stable violation codes.

External model boundaries must be mocked in unit tests. Exact model-output reproducibility is not an acceptance criterion unless a provider and implementation explicitly guarantee it.

Suggested result type:

```ts
type AdaptiveTestAudit = {
  configuration: TestGenerationConfig;
  samplesGenerated: number;
  passed: number;
  failed: number;
  inclusion: {
    punctuationSamples: number;
    numberSamples: number;
  };
  violations: Array<{
    stage: "generator" | "downstream";
    seed?: number;
    text: string;
    code: string;
    details?: Record<string, unknown>;
  }>;
};
```

Acceptance checks:

- Targeted tests run locally.
- Audit can generate a structured report.
- Current failures are visible instead of hidden.
- Characterization tests pass by asserting current behavior and expected violation codes.
- Default audit mode exits zero even when product violations are reported.
- Only explicit strict mode exits nonzero; CI does not run strict mode in Phase 1.
- No large unrelated production refactor.
- No database migration.
- Test framework follows repository conventions.

Rollback:

- Reverting this branch should only remove tests or small testability hooks.

---

## PHASE 2 — Adaptive Configuration Pipeline Repair

### Branch: `fix/adaptive-config-pipeline`

Purpose:

Repair the flow between UI settings, normalized configuration, generation logic, and rendered typing tests.

Expected work:

- Define one canonical `TestGenerationConfig`.
- Remove or consolidate duplicated default settings.
- Validate configuration at the boundary where tests are generated.
- Make the effective configuration inspectable.
- Ensure punctuation and number settings are honored.
- Store effective configuration with results where appropriate.
- Keep generator and validator separate.

Potential type:

```ts
type TestGenerationConfig = {
  mode: "words" | "time";
  wordCount?: number;
  durationSeconds?: number;
  difficulty: "easy" | "medium" | "hard" | "auto";
  punctuation: boolean;
  numbers: boolean;
  capitalization: boolean;
  seed?: string;
};
```

Acceptance checks:

- All Phase 1 audit combinations pass.
- The UI value matches the API or function input.
- The function input matches effective generated behavior.
- Existing typing modes continue working.
- No unrelated UI redesign.
- No unrelated settings expansion.
- Type check, lint, build, and targeted tests pass.

Rollback:

- Revert branch merge.
- Preserve old configuration path behind a short-lived feature flag if the change is high risk.

---

## PHASE 3 — Settings Schema and Persistence Design

### Branch: `feat/settings-schema-persistence`

Purpose:

Create a reliable settings model and explicitly choose its persistence boundary before redesigning the settings interface. Do not assume Postgres is automatically correct: accounts currently live in Postgres, game data lives in Firestore, and browser settings live in Zustand/localStorage.

Potential settings groups:

### Test Content

- Punctuation
- Numbers
- Capitalization
- Difficulty
- Test mode
- Word count
- Duration
- Adaptive mode

### Typing Experience

- Font size
- Line height
- Caret style
- Smooth caret
- Show live WPM
- Show live accuracy
- Highlight incorrect characters

### Appearance and Accessibility

- Theme
- Contrast preference
- Reduced motion
- Test width
- Optional focus mode

### Audio

- Typing sounds
- Error sounds
- Completion sounds
- Volume

Only expose settings that actually work.

Suggested preference model:

```ts
type UserTypingPreferences = {
  punctuation: boolean;
  numbers: boolean;
  capitalization: boolean;
  showLiveWpm: boolean;
  showLiveAccuracy: boolean;
  fontSize: "small" | "medium" | "large";
  caretStyle: "line" | "block" | "underline";
  reducedMotion: boolean;
};
```

Required design questions:

- What are global defaults?
- Which settings persist for authenticated users?
- Which settings are session-only?
- What is the precedence order?
- How are anonymous users handled?
- How are old users migrated?
- What happens if an unknown setting value is stored?
- Is optimistic UI appropriate?
- How is rollback handled if persistence fails?
- Should server persistence live with account data in Postgres or product data in Firestore?
- How will the chosen identity key bridge authenticated users, Firebase compatibility, and guests?

Desired precedence:

```text
Application defaults
        ↓
Stored user preferences
        ↓
Current session overrides
        ↓
Validated effective preferences
        ↓
Generator and renderer
```

Acceptance checks:

- The selected persistence owner and identity key are documented with repository evidence.
- Any required migration is additive and reversible.
- Defaults are defined in one place.
- Invalid stored data falls back safely.
- Existing users are supported.
- Setting writes and reads are tested.
- No settings UI redesign in this branch.
- No destructive migration.

Rollback:

- Down migration or safe schema/collection removal plan, if server persistence is introduced
- Application remains functional using defaults if persistence is disabled

---

## PHASE 4 — Settings UI and Customization

### Branch: `feat/settings-ui-redesign`

Purpose:

Redesign the gear/settings experience after settings behavior and persistence are reliable.

Requirements:

- Clear categories
- Accurate labels
- Working controls only
- Save behavior or immediate-apply behavior is explicit
- Reset to defaults
- Keyboard accessibility
- Proper focus management
- Responsive mobile behavior
- No typing area obstruction
- Visual consistency with BlazeKey
- Settings reflect effective state
- Changes are persisted according to the Phase 3 rules

Acceptance checks:

- Every visible toggle affects real behavior.
- Every visible control has an automated test where feasible.
- Settings open and close without permanent layout displacement.
- Keyboard navigation works.
- Escape behavior is defined.
- Focus returns to the triggering control.
- Mobile overflow is absent.
- Existing test completion flow still works.

Rollback:

- Feature flag can restore previous settings UI while preserving the new preference schema.

---

## PHASE 5 — Typing Layout and Browser Regression Suite

### Branch: `test/typing-layout-regression`

Purpose:

Define the typing experience as a layout contract and detect regressions across important viewports and states.

Suggested viewport set:

- 390 × 844
- 768 × 1024
- 1280 × 720
- 1440 × 900
- 1920 × 1080

States to test:

- Initial page load
- Test loaded
- Settings open
- Settings closed
- Mid-test
- Test completed
- Results visible
- Different text lengths
- Different font sizes
- Mobile and desktop

Potential assertions:

- Typing test stays inside viewport.
- No horizontal overflow.
- Settings do not permanently move the test.
- First line position remains within a documented range.
- Opening settings does not obscure required controls.
- Closing settings returns focus correctly.
- Results transition is intentional.
- Layout shift stays within an agreed threshold.
- Main test container remains centered within the intended content region.

Acceptance checks:

- Browser suite runs in CI.
- Failures include screenshots or trace files.
- Assertions are based on product contracts, not fragile exact pixels.
- No large visual redesign in this branch.

Rollback:

- Revert tests only if they are objectively incorrect.
- Do not weaken tests merely to accommodate regressions.

---

## PHASE 6 — Agent Task and Run Schema

### Branch: `feat/agent-task-schema`

Purpose:

Add the PostgreSQL foundation for agent tasks, runs, steps, findings, and approvals.

Initial tables:

### `agent_tasks`

Suggested fields:

```text
id
source
title
description
area
status
priority
autonomy_level
allowed_paths
prohibited_paths
acceptance_criteria
success_metric
github_issue_number
created_at
updated_at
```

Suggested sources:

```text
directed
github
discovery
analytics
test_failure
runtime_error
```

Suggested statuses:

```text
new
triaged
investigating
plan_ready
awaiting_approval
approved
implementing
testing
preview_ready
awaiting_review
monitoring
complete
blocked
failed
cancelled
```

### `agent_runs`

Suggested fields:

```text
id
task_id
status
model
started_at
completed_at
summary
error
token_usage
estimated_cost
```

### `agent_steps`

Suggested fields:

```text
id
run_id
step_type
status
input_json
output_json
started_at
completed_at
```

### `agent_findings`

Suggested fields:

```text
id
run_id
task_id
category
severity
confidence
evidence_json
recommended_action
created_at
```

### `agent_approvals`

Suggested fields:

```text
id
task_id
run_id
approval_type
status
approved_by
approved_at
notes
```

Approval types:

```text
approve_plan
approve_implementation
approve_preview
approve_merge_recommendation
approve_migration
```

Schema requirements:

- Use the repository’s existing ORM and migration system.
- Prefer additive migrations.
- Use `jsonb` only where flexible structured data is justified.
- Add indexes for task status, run status, task relationship, and timestamps.
- Add foreign keys.
- Define deletion behavior explicitly.
- Prevent accidental cascade deletion of useful audit history.
- Include a reversible migration where the tooling supports it.

Acceptance checks:

- Migration applies to local development database.
- Migration reverses safely.
- CRUD tests pass.
- Existing product data is unaffected.
- No model calls or GitHub integration in this branch.

Rollback:

- Reverse migration.
- Confirm no product tables depend on agent tables.

---

## PHASE 7 — Deterministic Audit Runner

### Branch: `feat/agent-audit-runner`

Purpose:

Create a non-AI task runner that executes known audits and records results.

Initial supported task:

- Adaptive punctuation and numbers audit

Later audits:

- Settings persistence audit
- Layout regression audit
- Build and type-check audit
- Accessibility audit
- PartyKit race-state audit

Core workflow:

```text
Load task
  ↓
Create agent run
  ↓
Mark task investigating
  ↓
Execute deterministic tool
  ↓
Store step and result
  ↓
Create findings
  ↓
Complete or fail run
```

Important properties:

- Idempotent where possible
- Explicit timeouts
- Clear failure recording
- Structured tool output
- No model required
- No repository writing
- No branch creation
- No deployment

Acceptance checks:

- A task can be created and executed.
- The audit result is stored in PostgreSQL.
- Failed runs preserve error context.
- Re-running does not corrupt prior history.
- Admin or internal API can display the result.

Rollback:

- Disable runner route or job.
- Preserve historical records.

---

## PHASE 8 — Read-Only Product Planning Agent

### Branch: `feat/agent-readonly-planner`

Purpose:

Add the first actual model-based capability: evidence-driven planning without code modification.

Inputs:

- Task description
- Allowed and prohibited scope
- Relevant architecture documentation
- Relevant source excerpts
- Deterministic audit output
- Existing test failures
- Recent related changes
- Product constraints

Structured output:

```ts
type ProductAgentPlan = {
  problemSummary: string;
  evidenceSummary: string[];
  probableCauses: Array<{
    cause: string;
    evidence: string[];
    confidence: number;
  }>;
  relevantFiles: string[];
  proposedChanges: Array<{
    fileOrArea: string;
    change: string;
    reason: string;
  }>;
  testPlan: string[];
  risks: string[];
  openQuestions: string[];
  requiresMigration: boolean;
  requiresApproval: true;
};
```

The planner may:

- Read approved context
- Read audit results
- Read selected code
- Produce a plan
- Store the plan
- Request approval

The planner may not:

- Edit files
- Run arbitrary shell commands
- Create branches
- Create pull requests
- Apply migrations
- Deploy

Acceptance checks:

- Output is schema-validated.
- Plan cites actual evidence.
- Plan does not exceed allowed scope.
- Hallucinated files are rejected or flagged.
- A plan cannot transition to implementation without approval.
- Model errors are stored.
- Prompt and model version are recorded.

Rollback:

- Disable model-planning feature flag.
- Deterministic audits remain usable.

---

## PHASE 9 — GitHub Control Plane

### Branch: `feat/agent-github-control-plane`

Purpose:

Use GitHub Issues and pull requests as the initial user-facing control plane.

Potential labels:

```text
agent-ready
agent-discovered
agent-needs-review
agent-blocked
agent-approved

area:adaptive-test
area:settings
area:layout
area:multiplayer
area:analytics

risk:low
risk:medium
risk:high
```

Potential commands:

```text
/agent plan
/agent audit
/agent implement
/agent revise
/agent test
/agent preview
/agent stop
/agent discover area:<area>
```

Initial implementation should support only safe commands such as:

- `/agent plan`
- `/agent audit`
- `/agent stop`

Later branches may support implementation commands.

Requirements:

- Authenticate webhook events.
- Ignore untrusted commands.
- Confirm repository and user authorization.
- Record issue-to-task mapping.
- Prevent duplicate task creation.
- Store GitHub identifiers.
- Use least-privilege GitHub App permissions.
- Do not merge automatically.

Acceptance checks:

- Approved issue creates or updates one task.
- Duplicate webhook delivery is safe.
- Unauthorized users cannot trigger runs.
- Agent comments are clearly identified.
- Stop command cancels future work safely.

Rollback:

- Disable webhook or GitHub App installation.
- Internal task system remains available.

---

## PHASE 10 — Controlled Draft Pull Request Executor

### Branch: `feat/agent-draft-pr-executor`

Purpose:

Allow the system to implement approved low-risk work in an isolated branch and open a draft pull request.

This is the first Cursor-like capability, but it remains only one controlled tool in the larger product workflow.

Required permissions:

- Read repository
- Create branch
- Modify allowed paths
- Run approved commands
- Create commits
- Open draft pull request
- Attach test results
- Request human review

Prohibited actions:

- Merge
- Deploy production
- Modify secrets
- Change authentication
- Change billing
- Run destructive commands
- Modify prohibited paths
- Apply unapproved migrations
- Force-push shared branches
- Delete production data

Task-level controls:

```ts
type AgentTaskPermissions = {
  autonomyLevel: 0 | 1 | 2 | 3;
  allowedPaths: string[];
  prohibitedPaths: string[];
  allowedCommands: string[];
  maxFilesChanged?: number;
  maxDiffLines?: number;
  migrationAllowed: boolean;
};
```

Suggested autonomy levels:

### Level 0 — Observe

Read, audit, and report only.

### Level 1 — Propose

Create findings, plans, and GitHub issues.

### Level 2 — Implement

Create branch, edit allowed files, run tests, open draft pull request.

### Level 3 — Preview

Level 2 plus preview deployment and preview smoke tests.

Do not add autonomous production merge in the initial project.

Acceptance checks:

- Branch is created from expected base.
- Only allowed paths change.
- Diff-size limits are enforced.
- Targeted tests run.
- Type check, lint, and build run.
- Draft PR includes scope, evidence, tests, risks, and rollback.
- The system stops for human review.
- Failed implementation leaves the branch inspectable.
- A stop command prevents further actions.

Rollback:

- Close draft pull request.
- Delete implementation branch.
- No production effect should have occurred.

---

## PHASE 11 — Discovery Scouts

### Branch: `feat/agent-discovery-scouts`

Purpose:

Allow the system to propose work when the approved queue is empty.

Initial scouts should be narrow.

### Scout A — Functional Correctness

- Run adaptive generation audits.
- Detect failed settings invariants.
- Detect configuration mismatches.
- Detect empty or invalid generated tests.

### Scout B — UI and Layout Stability

- Run Playwright at fixed viewports.
- Detect overflow.
- Detect permanent displacement.
- Detect obscured controls.
- Save screenshots and traces.

### Scout C — Runtime and Regression Errors

- Read approved error sources.
- Cluster repeated failures.
- Associate errors with product areas.
- Propose tasks only when evidence is sufficient.

### Scout D — Product Behavior

Only after analytics instrumentation is trustworthy:

- Identify drop-offs.
- Identify suspicious settings usage.
- Compare test-start and completion behavior.
- Compare adaptive and standard test outcomes.
- Generate hypotheses, not conclusions.

Discovery rules:

- Create proposals only.
- Include evidence.
- Include confidence.
- Include user impact.
- Include effort and regression risk.
- Do not implement automatically.
- Avoid duplicate issues.
- Stop when no meaningful finding exists.

Suggested priority score:

```text
priority =
(user_impact × frequency × confidence × strategic_importance)
÷ (implementation_effort × regression_risk)
```

This score is a ranking aid, not an objective truth.

Acceptance checks:

- Findings are evidence-backed.
- Duplicate suppression works.
- Low-confidence findings are labeled.
- No discovery run edits code.
- Human approval is required before implementation.

Rollback:

- Disable specific scouts independently.

---

## PHASE 12 — Product Outcome Measurement

### Branch: `feat/agent-product-metrics`

Purpose:

Measure whether implemented changes improve BlazeKey.

Potential metrics:

- Test-start rate
- First-test completion rate
- Second-test conversion
- Settings-open to test-start conversion
- Adaptive-test completion
- Error rate
- Seven-day return rate
- Average tests per user
- Multiplayer rematch rate
- Preview or production regression rate
- Support issue frequency
- User preference adoption
- Performance and latency

Workflow:

```text
Task defines success metric
        ↓
Baseline recorded
        ↓
Change merged by human
        ↓
Observation window
        ↓
Metric comparison
        ↓
Validated, inconclusive, or revert recommended
```

Requirements:

- Do not claim causation from correlation alone.
- Record experiment window.
- Record sample size.
- Record segmentation.
- Track confounders where possible.
- Prefer feature flags or controlled rollout for important experiments.
- Protect user privacy.
- Avoid sending raw sensitive data to models.

Acceptance checks:

- Metric definitions are documented.
- Baseline and follow-up are stored.
- Agent can state uncertainty.
- Product decision remains human-controlled.

Rollback:

- Disable experiment or feature flag.
- Revert implementation if warranted.

---

## PHASE 13 — Portfolio and Case Study

### Branch: `docs/agent-case-study`

Purpose:

Turn the project into clear AI engineering evidence.

Document:

- Problem
- Existing BlazeKey architecture
- Agent architecture
- PostgreSQL task and trace model
- Tool registry
- Human approval model
- Deterministic evaluations
- Browser automation
- GitHub integration
- Example task lifecycle
- Failure modes
- Safety boundaries
- Product results
- Cost and latency
- Lessons learned
- Future work

Target résumé narrative:

> Built an evidence-driven product engineering agent for BlazeKey that combined deterministic product audits, PostgreSQL-backed task state, structured LLM planning, human approval gates, GitHub branch and pull-request automation, browser regression testing, and product outcome measurement. The system investigated adaptive typing and UI issues, generated scoped implementation plans, created validated draft pull requests, and measured whether changes improved user behavior while maintaining explicit safety and rollback boundaries.

The final résumé should use real numbers only:

- Number of agent tasks
- Number of audited runs
- Pass-rate improvement
- Reduction in configuration failures
- Test coverage added
- Number of preview deployments
- Product conversion improvement
- Cost per run
- Time saved
- Users affected

---

# 7. Agent State Machine

Recommended lifecycle:

```text
NEW
 ↓
TRIAGED
 ↓
INVESTIGATING
 ↓
PLAN_READY
 ↓
AWAITING_APPROVAL
 ↓
APPROVED
 ↓
IMPLEMENTING
 ↓
TESTING
 ↓
PREVIEW_READY
 ↓
AWAITING_REVIEW
 ↓
MERGED_BY_HUMAN
 ↓
MONITORING
 ↓
VALIDATED / INCONCLUSIVE / REVERT_RECOMMENDED
```

Failure states:

```text
BLOCKED
FAILED
CANCELLED
```

Important rule:

The model does not decide the state by free-form text. Application logic controls transitions.

Example allowed transitions:

```text
new -> triaged
triaged -> investigating
investigating -> plan_ready
plan_ready -> awaiting_approval
awaiting_approval -> approved
approved -> implementing
implementing -> testing
testing -> preview_ready
preview_ready -> awaiting_review
awaiting_review -> monitoring
monitoring -> validated
monitoring -> inconclusive
monitoring -> revert_recommended
```

---

# 8. Tool Registry

The agent should use explicit tools rather than unrestricted access.

## Repository Tools

```text
search_repository
read_file
read_recent_commits
read_open_issues
read_pull_request
create_branch
apply_patch
create_commit
create_draft_pull_request
comment_on_issue
```

## Quality Tools

```text
run_adaptive_test_audit
run_unit_tests
run_typecheck
run_lint
run_build
run_playwright_test
run_accessibility_test
validate_generated_test
```

## Product Tools

```text
read_effective_settings
read_user_preference_schema
query_anonymized_product_events
compare_product_metrics
read_runtime_error_summary
```

## Deployment Tools

```text
create_preview_deployment
check_preview_health
run_preview_smoke_tests
```

## Control Tools

```text
create_agent_task
update_task_status
record_agent_step
record_finding
request_approval
report_blocker
cancel_run
```

Every tool should have:

- Typed input
- Typed output
- Timeout
- Error handling
- Permission check
- Logging
- Redaction
- Idempotency strategy where relevant

---

# 9. Security and Privacy Boundaries

The agent must not receive unnecessary user data.

Prefer:

- Aggregated analytics
- Anonymized identifiers
- Redacted logs
- Synthetic test data
- Limited code context
- Explicit secret filtering

Do not send to a model:

- Passwords
- Session tokens
- API keys
- Private user messages
- Raw payment details
- Unnecessary personal data
- Production database dumps

Repository commands must be allowlisted.

Potentially dangerous commands should be blocked, including destructive variants of:

```text
rm
drop database
truncate
git push --force
git reset --hard
kubectl delete
terraform destroy
```

Exact enforcement should match the actual stack.

---

# 10. Cursor Operating Instructions

Cursor is being used to build the system, but Cursor should not be allowed to make broad changes without understanding the repository.

## 10.1 First Cursor Session

Use read-only exploration.

Cursor should:

1. Inspect the repository.
2. Identify exact architecture.
3. Identify package manager.
4. Identify database access and migrations.
5. Identify test framework.
6. Identify current adaptive flow.
7. Identify settings flow.
8. Identify analytics.
9. Identify deployment and CI.
10. Update documentation only after findings are verified.

Initial prompt:

```text
Read this repository in read-only mode before implementing anything.

Use docs/BLAZEKEY_AGENT_CURSOR_CONTEXT.md as the long-term project context, but verify
every architectural assumption against the actual repository.

Create an accurate repository map covering:

1. Main Next.js routes and pages
2. Typing test rendering
3. Test text generation
4. Adaptive test logic
5. Settings and user preferences
6. PostgreSQL access, ORM, schemas, and migrations, plus Firestore data ownership
7. Authentication
8. Analytics events
9. PartyKit integration
10. Unit, integration, and browser tests
11. Deployment and CI
12. Existing branch and pull request conventions

For each area, identify exact files and responsibilities.

Do not edit production code.
Do not install packages.
Do not create migrations.
Do not refactor.

End with:
- a verified request-flow diagram
- a verified settings-flow diagram
- the smallest recommended first branch
- the exact commands currently used for tests, lint, type checking, and build
```

## 10.2 First Implementation Branch

The first implementation branch should be:

```text
test/adaptive-quality-harness
```

Cursor prompt:

```text
We are beginning Phase 1 from docs/BLAZEKEY_AGENT_CURSOR_CONTEXT.md.

Start from an updated, clean main after the Phase 0 documentation pull request is merged. Create and switch to:

test/adaptive-quality-harness

Before editing:
1. Trace punctuation and number settings from UI to generated text.
2. Identify the current test framework.
3. Identify the smallest production seam needed for testing.
4. Present a concise implementation plan.
5. Confirm characterization tests and product violations have separate pass/fail semantics.

The approved branch scope is:
- characterization tests
- deterministic local seeded support where minimally required
- an independent generated-test validator
- structured raw-generator and downstream-stage audit output
- default audit mode that reports violations and exits zero
- explicit strict mode that may exit nonzero, but is not enabled in Phase 1 CI

Do not:
- redesign the adaptive system
- redesign the settings UI
- modify PostgreSQL schemas
- modify authentication
- modify PartyKit
- install a new testing framework unless no test framework exists
- require exact reproducibility from an external model
- treat enabled punctuation/numbers as mandatory per sample without an approved density contract
- repair known adaptive product defects merely to make characterization tests green
- make unrelated refactors
```

## 10.3 Cursor Review Expectations

After each implementation:

Cursor must report:

- Branch name
- Files changed
- Why each file changed
- Tests added
- Commands run
- Results
- Remaining failures
- Risks
- Rollback procedure
- Recommended next branch

Do not accept “done” without checks.

---

# 11. Pull Request Template

Each major branch should use a pull request description similar to:

```md
## Purpose

What capability or problem does this branch address?

## Scope

What is included?

## Out of Scope

What was intentionally not changed?

## Evidence

What bug, test failure, analytics signal, or product requirement justified this work?

## Implementation

What changed at a high level?

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Checks Run

- [ ] Targeted tests
- [ ] Type check
- [ ] Lint
- [ ] Build
- [ ] Browser tests
- [ ] Migration test
- [ ] Preview smoke test

## Risks

What could regress?

## Rollback

How can this branch be safely reverted or disabled?

## Screenshots or Traces

Add where relevant.
```

---

# 12. Initial Product Backlog

Create issues for these known areas.

## Adaptive Test

1. Add adaptive punctuation and numbers audit.
2. Trace and normalize test configuration.
3. Make punctuation exclusion reliable.
4. Define the punctuation-enabled contract, then make inclusion meet it.
5. Make number exclusion reliable.
6. Define the numbers-enabled contract, then make inclusion meet it.
7. Verify displayed settings equal effective configuration.
8. Add reproducibility or seed support.
9. Store effective configuration with test results where useful.
10. Define adaptive difficulty behavior.

## Settings

1. Inventory existing settings.
2. Mark working, partially working, and non-working settings.
3. Define canonical preference schema.
4. Choose the persistence owner and identity key, then implement persistence if approved.
5. Add fallback behavior.
6. Add reset-to-default behavior.
7. Redesign settings UI.
8. Add accessibility behavior.
9. Add mobile behavior.
10. Add automated setting-to-behavior checks.

## Layout

1. Define typing test layout contract.
2. Add fixed viewport tests.
3. Test settings open and close.
4. Test results transition.
5. Test different text lengths.
6. Test font-size preferences.
7. Detect overflow and unexpected displacement.
8. Add screenshots or traces in CI.

## Agent Platform

1. Add task schema.
2. Add run and step schema.
3. Add approval schema.
4. Add deterministic audit runner.
5. Add internal task page.
6. Add read-only planner.
7. Add GitHub issue integration.
8. Add branch and draft PR executor.
9. Add discovery scouts.
10. Add outcome measurement.
11. Add cost and latency tracking.
12. Add case-study documentation.

---

# 13. Success Criteria for the First Major Milestone

The first meaningful BlazeKey Agent milestone is complete when the system can:

1. Accept a structured task.
2. Store it in PostgreSQL.
3. Run the adaptive test audit.
4. Store audit evidence.
5. Ask a model to analyze the evidence.
6. Produce a schema-validated implementation plan.
7. Store that plan.
8. Request human approval.
9. Stop without editing the repository.

The second meaningful milestone is complete when the system can:

1. Receive explicit implementation approval.
2. Create an isolated branch.
3. Change only allowed paths.
4. Run required checks.
5. Open a draft pull request.
6. Provide a preview where relevant.
7. Stop for human review.
8. Preserve complete run history.

The third meaningful milestone is complete when the system can:

1. Discover a real product problem from deterministic evidence.
2. Avoid duplicates.
3. Prioritize the finding.
4. Propose a task.
5. Wait for approval.
6. Implement and validate the approved work.
7. Measure the product result.

---

# 14. Anti-Patterns to Avoid

Do not:

- Ask Cursor to “build the entire agent” in one pass.
- Let one branch contain database, UI, testing, and autonomous agent changes.
- Let the model decide success without deterministic checks.
- Let the agent merge or deploy.
- Let the agent modify arbitrary files.
- Create a custom agent dashboard before the task and audit foundations work.
- Build a general-purpose coding IDE.
- Add many specialized sub-agents before one workflow works end to end.
- Store opaque free-form state without structured fields.
- Use production user data unnecessarily.
- claim product improvement without measurement.
- optimize the résumé story before the system is technically real.
- accept generated code that the developer cannot explain.
- hide failing tests.
- weaken tests to make a branch pass.
- skip rollback documentation.

---

# 15. Career and Résumé Alignment

This project should demonstrate the capabilities expected from an applied AI or AI engineering candidate:

- Agent orchestration
- Tool use
- Structured outputs
- PostgreSQL-backed state
- Human-in-the-loop approvals
- Deterministic evaluation
- Model-based reasoning
- Browser automation
- Repository integration
- GitHub workflows
- Observability
- Safety boundaries
- Product analytics
- Experimentation
- Production deployment
- Failure analysis
- Cost and latency awareness

The strongest interview narrative is:

> I did not build another chatbot. I extended an existing product with a domain-specific engineering agent. The agent can investigate typing-generation and UI problems using deterministic audits, create evidence-backed plans, operate through explicit permissions, produce isolated draft pull requests, and measure whether changes improved the product. I built the task state, tool contracts, evaluations, approvals, rollback model, and product feedback loop.

Important interview details to preserve during development:

- Why Postgres was used for agent state
- Why GitHub remained the control plane
- Why deterministic checks came before code generation
- Why implementation was separated into branches
- Why the agent could not merge
- How allowed paths and commands were enforced
- How model outputs were validated
- How duplicate discovery findings were handled
- How product success was measured
- Which failure modes occurred
- What changed after real use

---

# 16. Immediate Next Action

Do not start with the full agent implementation.

Current phase:

```text
Branch: docs/blazekey-agent-context
```

Tasks:

1. Commit this reconciled roadmap.
2. Add and review `docs/current-architecture.md`.
3. Add and review `docs/adaptive-test-flow.md`.
4. Add and review `docs/settings-flow.md`.
5. Confirm no production behavior changed.
6. Merge the documentation pull request.

Cursor rules, pull request templates, and issue templates are optional follow-up infrastructure. They are not prerequisites for the adaptive quality harness unless the repository demonstrates a concrete need.

After the documentation pull request is human-merged, update `main`, require a clean worktree, and create:

```text
Branch: test/adaptive-quality-harness
```

This is the first implementation branch.

The first coding goal is not autonomous code generation. It is a reliable answer to:

> Given a BlazeKey test configuration, did the generated typing test actually obey it?

That quality tool becomes the first real tool used by the future BlazeKey Product Engineering Agent.

---

# 17. Phase 2 Adaptive Configuration Boundary

Phase 2 was split into two sequential review units:

```text
fix/adaptive-config-core
  canonical config, pure finalizer, StringLRU repair, seeded fallbacks, audit, unit tests

fix/adaptive-config-runtime
  TypingTest/TypingBox integration, last-test migration, append/prefetch,
  effective results metadata, deterministic Playwright coverage, documentation
```

The canonical type intentionally excludes Blaze and capitalization. It controls only mode, count/duration, difficulty, punctuation, numbers, seed, word set, and repeat limit.

The Phase 1 baseline of 52 violations remains historical evidence. The repaired audit invokes the same finalizer as the normal solo runtime and reports zero strict violations. A discriminated `finalized-solo` prompt is the explicit contract preventing `TypingBox` from mutating validated solo text a second time; party and legacy behavior remains unchanged.
