# Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver readable production URLs and coherent chart branding, document and deploy the verified release.

**Architecture:** A shared navigation boundary maps public paths to existing workspace state. Exact Next rewrites reuse the existing app. Stable dataset IDs remain private API/storage contracts; chart components consume shared neutral/lavender tokens.

**Tech Stack:** Next.js 16.4.2, React 19, TypeScript, SVG/ECharts, Vitest, Docker Compose.

**Spec:** docs/superpowers/specs/2026-11-13-production-release-design.md

## Global Constraints
- Warm-white #f5f5f2, near-black #232329, lavender #7666cc; square containers and tabular numbers.
- No personal data in URLs; preserve permissions, small-group suppression, existing accounts and records.
- New isolated worktree and disposable runtime state; no real model calls during checks.
- Public URL source=sample maps to internal demo; old bookmarks read then canonicalize.

## Review Focus
- Path/query conflicts must not silently open another topic.
- Back/forward between data sources must not mix their trails.
- A refresh at every public route must return the real app, not 404.
- Default query omission must not change relationship-dependent drawings.
- Old favorites must not cause repeated history entries.

### Task 1: Canonical navigation
Files: new lib/navigation.ts; modify lib/exploration/concepts.ts, components/workspace.tsx, components/data-explorer.tsx, next.config.ts; update lib/exploration/concepts.test.ts.
Interfaces: workspaceHref(view, primary) writes canonical paths; workspaceParams(input) resolves paths and legacy queries; conceptHref and parseConceptLocation retain existing return types.
- [x] Exercise public sample links, relationship drawing defaults, conflicting path/query/source inputs and workspace ownership in focused Vitest; observe new assertions fail.
- [x] Implement the shared URL boundary, migrate every writer/reader, use exact rewrites.
- [x] Run focused Vitest then exercise deep-link refresh and native history in real browser.

### Task 2: Identity and charts
Files: app/icon.svg, app/theme.css, app/tokens.css, components/concept-chart.module.css, lib/exports/analysis.ts.
Interfaces: existing CSS token names and chart contracts unchanged.
- [x] Redraw favicon from existing ruler brand; replace orange chart families with neutral/lavender semantic roles and category tones; align report palette.
- [x] Inspect rendered charts and icon, desktop and narrow screens, light and dark AI charts; retain table/labels and suppression marks.

### Task 3: Documentation, validation and release
Files: README.md, docs/README.md, docs/workspace-guide.md, docs/architecture.md, docs/deployment.md.
- [x] Document canonical entry URLs, truthful sample naming, visual rules, release and rollback prerequisites.
- [x] Run typecheck, Vitest and production build serially; run isolated production/browser acceptance.
- [x] Commit only task files, integrate without overwriting user changes, push normally.
- [x] Build Linux candidate from committed source, smoke with isolated state, back up live records/config, replace app only and verify public paths/revision.
- [x] Record actual release evidence and push documentation; preserve rollback image and backup.
