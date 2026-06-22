## Architecture

Make sure all proposed plans and changes adhere to the guidelines in ARCHITECTURE.md.

## Before Code Commits

1. Run both `npm run check` AND `npm run test:quiet` before commits and report/fix any errors.
2. Ensure no updates to README or ARCHITECTURE are necessary as part of the change.
3. Ask the user if we should run the end to end tests.

## Before Pull Request

1. Ask the user if e2e tests have been run
2. Ensure HTML documentation is up to date. If it is not, suggest updating and invoke the `docs-authoring` skill before editing `docs.html`.

## Manual Testing

The **user** will handle all manual testing.
If a feature requires manual testing prompt the user to test manually.
Provide them with a numbered list of the most important use cases to test.

## Installing Packages

If you are asked to install packages, always first query for the most recent version of the package using npm.
Prefer the latest version unless there is an explicit reason to suggest an older version.

## Updating Package.json and Package-lock.json

Prefer npm commands to manual updates whenever possible.
