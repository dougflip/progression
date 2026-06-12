## Architecture

Make sure all proposed plans and changes adhere to the guidelines in ARCHITECTURE.md.

## Before Code Commits

Run both `npm run check` AND `npm run test:quiet` before commits and report/fix any errors

## Manual Testing

The **user** will handle all manual testing.
If a feature requires manual testing prompt the user to test manually.
Provide them with a numbered list of the most important use cases to test.

## Installing Packages

If you are asked to install packages, always first query for the most recent version of the package using npm.
Prefer the latest version unless there is an explicit reason to suggest an older version.

## Updating Package.json and Package-lock.json

Prefer npm commands to manual updates whenever possible.
