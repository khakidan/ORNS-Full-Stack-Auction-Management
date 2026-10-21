import "./server/env"; // Must be the first import - loads .env before any other module (notably server/app.ts) reads process.env; see server/env.ts for why textual order alone doesn't guarantee this in ESM
import "./server/services/google"; // Does not read process.env
import { app } from "./server/app";
import { validateEnv } from "./server/utils/validateEnv";
import { startServer } from "./server/boot";

validateEnv();
startServer(app, Number(process.env.PORT) || 3000);
// The PayPal sweeper has no timer here: Cloud Scheduler calls
// POST /internal/paypal-sweep (server/routes/schedulerRoutes.ts).
