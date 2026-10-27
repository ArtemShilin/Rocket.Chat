# Repository Guidelines

## Project Structure & Module Organization

This fork targets Rocket.Chat 8.9.0. `apps/meteor/` contains the main Meteor/React application; `packages/` contains shared libraries and types. Enterprise services and libraries live in `ee/`, with application extensions in `apps/meteor/ee/`.

Independent fork modules live in `custom/`: account devices, workspace devices, local AI, and response templates. Each module keeps server code, browser assets under `public/`, tests under `test/`, and its own README and validation report. `deploy/local/` contains Docker Compose configuration and management scripts. Consult `docs/` and `CLAUDE.md` for component-specific conventions.

## Build, Test, and Development Commands

Run commands from the repository root. Use Yarn 4.18.0 and the Node version specified in `package.json` (Volta pins 24.15.0).

- `yarn install --immutable`: install workspace dependencies from the lockfile.
- `yarn dev`: run the Meteor development application and dependencies through Turbo.
- `yarn build`: build workspace packages through Turbo.
- `yarn lint` / `yarn testunit`: run workspace linting or unit tests.
- `./deploy/local/manage.sh start`: start the prepared local Docker stack on `http://localhost:3000`.
- `./deploy/local/manage.sh check` / `browser-check`: verify persistent data or browser login and realtime messaging.
- `node --test custom/canned-responses/test/*.test.cjs`: run autonomous template-module tests.
- `DOCKER_BUILDKIT=0 ./deploy/local/manage.sh build-canned`: build the final custom image; deployment requires separately pinning its ID.

## Coding Style & Naming Conventions

Follow `.editorconfig`, `.prettierrc`, and `eslint.config.mjs`: tabs, LF endings, semicolons, single quotes, trailing commas, and a 140-character print width. Preserve surrounding conventions in existing CommonJS modules. Use PascalCase for React components and `useSomething` for hooks. Comments explain intent; architectural explanations belong in documentation.

## Testing Guidelines

Core tests use Jest, Mocha, and Playwright; custom modules also use Node’s built-in test runner. Follow existing `*.spec.ts(x)` and `*.test.cjs` naming. Cover changed behavior, authorization failures, and data isolation. Follow `docs/coverage.md` for coverage instrumentation. Test custom images on port 3001 before deployment and record results in the module’s `VALIDATION.md`.

## Commit & Pull Request Guidelines

Recent fork commits use imperative summaries such as “Add local personal and shared response templates.” Use feature branches and target `custom/main` for fork PRs. Follow `.github/PULL_REQUEST_TEMPLATE.md`: use an appropriate title prefix (`feat:`, `fix:`, `docs:`), explain behavior, link relevant issues, provide reproduction/test steps, and include screenshots for UI changes.

## Security & Deployment

Keep `.env`, `.state/`, backups, tokens, and model data out of Git. Back up MongoDB before deployment, pin image IDs, and preserve rollback information. Never remove data volumes during routine updates.
