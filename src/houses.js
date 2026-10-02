// -----------------------------------------------------------------------------
// Houses configured in Gladys.
//
// The manifest declares `"location": true`, so `gladys.getHouses()` returns
// `[{ id, name, selector, latitude, longitude }]`. Each LOCATED house gets its
// own solar forecast device; the user only adds (from the Discovery tab) the
// devices of the houses that really have solar panels, and only those are
// polled — so no request is wasted on the Forecast.Solar quota.
// -----------------------------------------------------------------------------

const isCoordinate = (value, limit) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/** Houses with usable coordinates. */
export function locatedHouses(houses = []) {
  return houses.filter(
    (house) => house && isCoordinate(house.latitude, 90) && isCoordinate(house.longitude, 180),
  );
}

/** Message shown in the Configuration screen when no house is located. */
export const NO_LOCATED_HOUSE_MESSAGE = {
  en: 'No house with a location in Gladys: set it in Settings > Houses.',
  fr: 'Aucune maison localisée dans Gladys : renseignez sa position dans Paramètres > Maisons.',
};
