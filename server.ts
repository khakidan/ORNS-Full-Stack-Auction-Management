import "./server/services/google"; // Must precede routes; does not read process.env
import dotenv from "dotenv";
dotenv.config(); // Must run before app/validateEnv imports read process.env

import { app } from "./server/app";
import { validateEnv } from "./server/utils/validateEnv";
import { startServer } from "./server/boot";

validateEnv();
startServer(app, Number(process.env.PORT) || 3000);