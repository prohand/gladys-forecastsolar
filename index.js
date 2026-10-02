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

const gladys = new GladysIntegration();
const app = createApp(gladys);

// --- Discovery: one device per located house ---------------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await gladys.publishDiscoveredDevices(await app.discoveredDevices());
});

// --- Polling: Gladys asks to refresh a created device ------------------------
gladys.onPoll((device) => app.poll(device));

// --- The user added a device: publish its values without waiting ------------
gladys.onDeviceCreated((device) => app.onDeviceCreated(device));

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

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Forecast.Solar integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
