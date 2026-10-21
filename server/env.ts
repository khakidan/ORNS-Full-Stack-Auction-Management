import dotenv from "dotenv";

// Loads .env for local development. On Cloud Run the variables are set
// on the service itself and there is no .env file, so this is a no-op
// there (dotenv never overwrites a variable that's already set).
//
// Side-effecting module, imported first (before any other local import) by
// server.ts - in ESM, import statements are evaluated before any plain
// statement in the importing file regardless of textual order, so writing
// `dotenv.config()` before `import { app } from "./server/app"` in
// server.ts does NOT guarantee it runs first: all of that file's imports
// (including app.ts, which reads process.env.SESSION_SECRET at module
// load) are evaluated before any of its own top-level statements, such as
// the dotenv.config() call. Making env-loading its own first import fixes
// the ordering, since sibling imports evaluate in declaration order.
dotenv.config();
