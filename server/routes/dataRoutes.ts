import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import createSyncRouter from './syncRoutes';
import createSweeperRouter from './sweeperRoutes';
import createSettingsRouter from './settingsRoutes';
import createItemRouter from './itemRoutes';
import createSheetsProxyRouter from './sheetsProxyRoutes';
import createDriveRouter from './driveRoutes';
import createArchiveRouter from './archiveRoutes';
import createUserRouter from './userRoutes';
import createAttendeeRouter from './attendeeRoutes';
import createActionHistoryRouter from './actionHistoryRoutes';
import createVolunteerRouter from './volunteerRoutes';
import createChangesRouter from './changesRoutes';
import createConfigRouter from './configRoutes';

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
  router.use(createArchiveRouter());
  router.use(createUserRouter());
  router.use(createAttendeeRouter());
  router.use(createActionHistoryRouter());
  router.use(createVolunteerRouter());
  router.use(createChangesRouter());
  router.use(createConfigRouter());
  return router;
}
