# SpanVoc delivery

## Application

Live app: https://gildernew-max.github.io/SpanVoc/

Static HTML and JavaScript with 500 Spanish vocabulary cards. Learning progress is stored in the current browser. No package installation is needed. index.html loads app.js; app2.js is an unused older copy.

## Validation

Run `node --test tests/*.test.cjs` with Node.js 24. The App checks workflow runs JavaScript syntax checks and regression tests on main pushes and pull requests. Tests cover duplicate answers, answers before reveal, repeated 20-card sessions with preserved XP, and counter updates.

These tests use a simulated browser environment. Browser testing is still required for layout, keyboard controls, and complete learner flows.

## Release procedure

1. Inspect the latest main branch and concurrent changes.
2. Make a bounded change and add a regression test for confirmed defects.
3. Run tests and inspect the diff.
4. Browser-test the affected flows.
5. Publish without overwriting concurrent work.
6. Verify the GitHub Pages deployment and live assets; a commit alone does not prove deployment.
7. If needed, revert the release commit while preserving later work, then verify deployment again.

GitHub Pages currently deploys from the branch independently of App checks. The checks are not yet a deployment gate. Next infrastructure task: make successful validation a prerequisite for publishing.

## Verified releases

- be6daca: duplicate-answer protection, restarted new-card allowance for Play Again, refreshed counters, and versioned script URLs. Four regression tests and a full browser session/restart passed. Pages run 34715789058 succeeded; live scripts matched tested files.
- 801b557: published the four regression tests.
- 48a1856: enabled App checks. First run passed: https://github.com/gildernew-max/SpanVoc/actions/runs/34716546893

## Next work

- Gate deployment on successful validation.
- Test small screens, keyboard navigation, and accessibility.
- Audit Hard rating behavior, missed-card timing, stale streak display, and storage failure recovery.
- Clarify session persistence: session scores reset on reload, while long-term progress remains stored.
- Before monetization, validate the audience and paid offer, review vocabulary accuracy and provenance, and design purchases, access recovery, support, and privacy information.
