# Forecast.Solar

This integration shows in Gladys the **production forecast** of your solar
panels, computed by the free [Forecast.Solar](https://forecast.solar) service
from the weather forecast.

## What you get

One **Solar forecast** device with 4 sensors:

| Sensor                           | Unit | Content                                   |
| -------------------------------- | ---- | ----------------------------------------- |
| Estimated power now              | W    | Estimated power right now                 |
| Estimated energy today           | kWh  | Estimated production for the whole day    |
| Estimated energy remaining today | kWh  | Estimated production until the end of day |
| Estimated energy tomorrow        | kWh  | Estimated production for tomorrow         |

These are **forecasts**, not measurements: they are not counted in the Gladys
energy monitoring. Use them, for example, to start an appliance (water heater,
washing machine…) when a good production is expected.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Fill in:
   - **Latitude / Longitude**: position of the panels (right-click on
     Google Maps or OpenStreetMap to get them);
   - **Tilt**: 0° = flat, 90° = vertical (often 30 to 35° on a roof);
   - **Orientation**: 0° = south, -90° = east, 90° = west, 180° = north;
   - **Peak power** in kWp (written on your contract or inverter).
3. The **API key** is optional: leave it empty for the free plan.
4. Save, then add the device from the **Discovery** tab.

The **Refresh the forecast now** button downloads the forecast right away and
shows a summary for today and tomorrow.

## How it works

- The forecast is downloaded every 60 minutes by default (15 to 1440 minutes).
- Between two downloads, the values are recomputed and published every
  5 minutes (the power follows the sun curve).
- The free plan allows **12 requests per hour** per IP address. On an error
  or when the limit is reached, the integration retries 15 minutes later and
  keeps the last known forecast.
- Only one plane of panels is supported. For an east/west installation, enter
  the orientation and peak power of the main plane.

## Troubleshooting

- **"Configuration incomplete or invalid"** in the Configuration screen: a
  required field is empty or out of range (the field name is given).
- **"Forecast.Solar request limit reached"**: too many requests from your IP
  address (another software also using Forecast.Solar?). Raise the refresh
  interval.
- For details, read the integration logs from Gladys (or `docker logs` on the
  host) with `LOG_LEVEL=debug`.
