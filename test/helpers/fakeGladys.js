// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the integration relies on and records every
// call so tests can assert them, without a running Gladys server.
// -----------------------------------------------------------------------------

export const HOUSES = [
  { id: 'house-1', name: 'Home', selector: 'home', latitude: 48.8566, longitude: 2.3522 },
  { id: 'house-2', name: 'Cottage', selector: 'cottage', latitude: null, longitude: null },
];

export function createFakeGladys({ houses = HOUSES, createdDevices = [] } = {}) {
  const published = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];
  const discovered = [];

  const gladys = {
    published,
    connectionStatuses,
    sceneEvents,
    widgetRefreshes,
    discovered,
    houses,
    devices: createdDevices,

    externalIds(type, platformId) {
      const device = `ext:forecast-solar:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async getHouses() {
      return gladys.houses;
    },

    async getDevices() {
      return gladys.devices;
    },

    async publishDiscoveredDevices(devices) {
      discovered.push(devices);
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
    },

    async publishSceneEvent(key, data) {
      sceneEvents.push({ key, data });
    },

    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },
  };
  return gladys;
}
