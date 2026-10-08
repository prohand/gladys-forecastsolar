// -----------------------------------------------------------------------------
// Entry point of the Forecast.Solar integration for Gladys.
//
// Role of this file: wire the SDK to the integration logic (src/app.js). It
// holds NO forecast logic. This file only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects and synchronizes houses and devices.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

// A promise rejected with no handler (a scene event or a widget nudge sent
// while Gladys restarts…) would otherwise end the process on Node >= 15: the
// container would restart and forget the forecast cache, costing quota. Log
// it and keep running; real crashes (uncaught exceptions) still exit.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

const gladys = new GladysIntegration();
const app = createApp(gladys);

// The app's own refresh loop: Gladys only polls the devices created with
// `should_poll: true`, so an older device would otherwise stay frozen.
const REFRESH_LOOP_MS = 60 * 1000;
let refreshTimer = null;
function startRefreshLoop() {
  if (refreshTimer) {
    return;
  }
  refreshTimer = setInterval(() => {
    app.pollCreated().catch((err) => logger.error('Scheduled refresh failed', err));
  }, REFRESH_LOOP_MS);
  refreshTimer.unref?.();
}
function stopRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// --- Discovery: one device per located house ---------------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await gladys.publishDiscoveredDevices(await app.discoveredDevices());
});

// --- Polling: Gladys asks to refresh a created device ------------------------
gladys.onPoll((device) => app.poll(device));

// --- The user added a device: publish its values without waiting ------------
gladys.onDeviceCreated((device) => app.onDeviceCreated(device));

// --- The user updated a device (e.g. "Update" in Discovery): same replay ----
gladys.onDeviceUpdated((device) => app.onDeviceUpdated(device));

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [key, handler] of Object.entries(app.actions)) {
  gladys.onAction(key, (fields) => handler(fields));
}

// --- Scene actions: run when a scene reaches them ----------------------------
for (const [key, handler] of Object.entries(app.sceneActions)) {
  gladys.onSceneAction(key, (fields) => handler(fields));
}

// --- Dashboard widgets: Gladys pulls their content ---------------------------
for (const [key, handler] of Object.entries(app.widgets)) {
  gladys.onWidgetGet(key, (request) => handler(request));
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  app.setConfig(newConfig);
  await app.synchronize();
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle under the `gladys-sdk` name.
// Houses have no update event: they are re-read on every (re)connection, on
// every scan, and every hour.
gladys.on('connected', async () => {
  // Armed first: a failed synchronization (network not up yet) must not leave
  // the devices without a refresh.
  startRefreshLoop();
  // States sent while disconnected may be lost: publish everything again.
  app.forgetPublishedStates();
  try {
    app.setConfig(await gladys.getConfig());
    await app.synchronize();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// Paused while Gladys is away: every poll would only fail to publish. The
// 'connected' handler re-arms it on reconnection.
gladys.on('disconnected', () => {
  logger.info('Disconnected from Gladys -> refresh loop paused');
  stopRefreshLoop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopRefreshLoop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Forecast.Solar integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
