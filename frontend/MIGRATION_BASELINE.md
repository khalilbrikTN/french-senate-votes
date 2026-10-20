# React migration baseline

This file records the working frontend behavior and API boundaries to preserve while the React app is built alongside it.

## Workspace boundary

- The working site is the root `index.html`, `app.js`, and `style.css`; FastAPI currently serves those files at `/`.
- The React scaffold is the untracked `frontend/` directory. Its Vite dev server is configured for port 5173 and proxies `/api` to `http://127.0.0.1:8000`.
- Keep the root site files and their serving behavior unchanged during the React build. Develop and review the new app through Vite until an explicit cutover is approved.
- The React HTML points to `src/main.tsx`, which does not exist yet. The scaffold has API types/client/endpoints and pure helper modules, but no React entry, components, stylesheet import, or tests.

## User-visible behavior to preserve

### Shared shell and navigation

- French-language site, header, source status, session selector, mobile hamburger menu, search overlay, footer, and current responsive styling.
- Four views selected by navigation and represented by `#scrutins`, `#senateurs`, `#groupes`, and `#stats`; the logo returns to scrutins.
- The header search opens from both the header and the scrutins hero. Escape and the close button dismiss it.
- Search results show up to five matching scrutins and five currently loaded senators. Selecting a result opens its detail dialog.

### Scrutins

- The session selector filters the list and the scrutins hero figures; statistics use the same selected session.
- Result chips filter all/adopted/rejected. Sort choices cover date and session-plus-number order. Keyword search checks title, number, and date.
- Show 18 rows initially, with “load more” adding another page. Refresh reloads the main data.
- A card opens a detail dialog with vote totals and percentages, group breakdowns when present, individual-voter tabs, the partial-list scope note, corrections, and the official Senate link.
- A voter with a matching senator record can open that senator's profile from the scrutin dialog.

### Senators

- Active senators are the initial list. Former senators load on demand when former/all is selected. Filters cover status, group, name/department/commission, and sorting by name or group.
- A profile includes identity, mandate/status, group, department, commission, profession, social links, vote totals, paginated voting history (50 rows), and group-career timeline.
- A history row can open the related scrutin. Group cards can navigate to the senator list with that group selected.

### Groups and statistics

- Group cards show live seats and leader data when available, with local metadata/colors as fallback, plus a link to the group's senators.
- Statistics include session totals, adoption/rejection rates, average voters, seat distribution, and the closest votes. Selecting a close vote opens its detail dialog.

### Loading and asynchronous behavior

- Startup checks `/api/status`, then loads `/api/senateurs`, `/api/scrutins`, and optional `/api/stats`. If the API is unavailable, the legacy app attempts `./data/*.json` and reports unavailable data if that fallback is absent.
- Former senators and dialog details are fetched lazily. Senator history uses 50-item pages. The legacy app uses request tokens for dialog history/career and scrutin voters so older responses do not replace newer dialog content.
- Preserve loading, empty, failure, and retry states. API-provided values must be rendered as text/attributes safely, not interpolated as raw HTML.

## API compatibility decisions

- Keep the first React pass on the legacy list contracts: `/api/senateurs`, `/api/senateurs?status=ANCIEN`, `/api/scrutins`, `/api/stats`, `/api/senateurs/{id}/votes`, and `/api/scrutins/{session}/{number}`. The scrutin list is complete and filtered client-side today.
- Use `/api/v1/senators/{id}` for the senator detail/career data already represented by the scaffold.
- Treat scrutin identity as the pair `(session, number)`: numbers repeat between sessions.
- `/api/v1/votes` is paginated. Do not replace the complete legacy scrutin list with a single v1 page during the parity pass.
- Keep the existing fallback group metadata in one TypeScript source for React; do not edit the legacy JavaScript metadata while it remains the running site.

## Baseline status

At the start of step 1, Git reported branch `react-frontend` with `frontend/` untracked. No root frontend or backend files were modified for this baseline. No tests were run; the React scaffold does not yet define a test suite.
