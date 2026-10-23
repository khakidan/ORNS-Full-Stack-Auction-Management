import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import createSyncRouter from './syncRoutes';
import createSweeperRouter from './sweeperRoutes';
import createSettingsRouter from './settingsRoutes';
import createItemRouter from './itemRoutes';
import createSheetsProxyRouter from './sheetsProxyRoutes';
import createDriveRouter from './driveRoutes';

/**
 * The signed-in "/api" routes that aren't live-auction transactions
 * (those are in bidRoutes.ts), one file per area. Every one needs a
 * session, so requireAuth is applied once here.
 */
export default function createDataRouter() {
  const router = Router();
  router.use(requireAuth);
  router.use(createSyncRouter());
  router.use(createSweeperRouter());
  router.use(createSettingsRouter());
  router.use(createItemRouter());
  router.use(createSheetsProxyRouter());
  router.use(createDriveRouter());
  return router;
}
