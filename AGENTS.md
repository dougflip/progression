## Architecture

Make sure all proposed plans and changes adhere to the guidelines in ARCHITECTURE.md.

### v2

ARCHITECTURE.md describes v1. For any v2 work, first read (in order):

1. `docs-internal/v2/decisions.md`: current decisions
2. `docs-internal/v2/data-model.md` (+ the schema in `v2/src/model/schema.ts`, runtime types in `v2/src/model/runtime.ts`): data model and data flow
3. `docs-internal/v2/milestones.md`: the build plan and ground rules

`docs-internal/v2/mockup.html` is the UI spec (open it in a browser). Keep v2 docs concise and rewrite them to reflect current understanding rather than appending history.

## Before Code Commits

1. Run both `npm run check` AND `npm run test:quiet` before commits and report/fix any errors.
2. Ensure no updates to README or ARCHITECTURE are necessary as part of the change.
3. Ask the user if we should run the end to end tests (do not run yourself unless told to do so).

## Before Pull Request

1. Ask the user if e2e tests have been run
2. Ensure HTML documentation is up to date. If it is not, suggest updating and invoke the `docs-authoring` skill before editing `docs.html`.
3. _Suggest_ a major/minor/patch version bump to the app version number based on significance of changes.

- If asked to bump the version use NPM to do so For example: `npm version patch`.

## Manual Testing

The **user** will handle all manual testing.
If a feature requires manual testing then prompt the user to test manually.
Provide them with a numbered list of the most important use cases to test.

## Installing Packages

If you are asked to install packages, always first query for the most recent version of the package using npm.
Prefer the latest version unless there is an explicit reason to suggest an older version.

## Updating Package.json and Package-lock.json

Prefer npm commands to manual updates whenever possible.
