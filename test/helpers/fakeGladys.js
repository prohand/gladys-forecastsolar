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

/**
 * @param {object} [options]
 * @param {() => number} [options.now] the clock of publishChangedStates'
 *   heartbeat; the SDK reads Date.now(), the tests hand the app's fake clock
 */
export function createFakeGladys({
  houses = HOUSES,
  createdDevices = [],
  now = () => Date.now(),
} = {}) {
  const published = [];
  // publishChangedStates' memory: feature external_id -> { state, text, at },
  // the last value Gladys accepted, as the SDK keeps it.
  const publishedStates = new Map();
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

    // Same contract as the SDK (0.15.0): an entry equal to the last accepted
    // value of its feature is skipped unless older than `heartbeat`; values
    // are remembered before the request and forgotten again if it fails.
    async publishChangedStates(states, { heartbeat } = {}) {
      const time = now();
      const previous = new Map();
      const changed = states.filter(({ device_feature_external_id: id, state, text }) => {
        const last = previous.has(id) ? previous.get(id) : publishedStates.get(id);
        previous.set(id, { state, text, at: time });
        return (
          last === undefined ||
          last.state !== state ||
          last.text !== text ||
          (heartbeat !== undefined && time - last.at >= heartbeat)
        );
      });
      for (let start = 0; start < changed.length; start += 100) {
        const batch = changed.slice(start, start + 100);
        batch.forEach(({ device_feature_external_id: id, state, text }) =>
          publishedStates.set(id, { state, text, at: time }),
        );
        try {
          await gladys.publishStates(batch);
        } catch (err) {
          batch.forEach(({ device_feature_external_id: id }) => publishedStates.delete(id));
          throw err;
        }
      }
      return { success: true, count: changed.length };
    },

    forgetPublishedStates(externalId) {
      if (externalId === undefined) {
        publishedStates.clear();
        return;
      }
      for (const id of [...publishedStates.keys()]) {
        if (id === externalId || id.startsWith(`${externalId}:`)) {
          publishedStates.delete(id);
        }
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
