
## Styling

- Use tailwind. Avoid manual CSS.
- Keep design lean. Use cards, wrapper divs and containers ONLY when necessary
- lucide for icons

## Architecture

Within `src/`, use a layered architecture.
A component may only import from a lower layer, never to siblings or parents. Enforce this in the linter.



`dumb`: collection of simple, reusable stuff. no business logic. may not import from ANY other high-level folder. may cross-import within the folder. put assets here (if needed)
`entities`: models/entities. One folder per user-space entity such as "flashcard". May import from db, but nothing else.
`features`: ways of interacting with entities. one folder per feature, following an entity-action (e.g. flashcard-manage) pattern. may NOT import one another. may ONLY import from dumb or entities, NEVER from other features.
`meta`: Complex "meta"-features, to be used rarely.
`pages`: One folder per page (a page is something used by the router.ts file). If functionality is ONLY used on a given page, put it in the page folder (avoid having just a single giant page file, split it up!), do not create features or meta-features that are only used by one single page. Especially the main practice page will grow very complex, so give it a sane substructure.

No other high-level folders are allowed. Do not use index.ts file reexporting components, simply export directly.