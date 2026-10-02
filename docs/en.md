# Forecast.Solar

This integration shows in Gladys the **production forecast** of your solar
panels, computed by the free [Forecast.Solar](https://forecast.solar) service
from the weather forecast.

Requires **Gladys 5.1.0** or later.

## Houses

The location comes from the **houses configured in Gladys**
(**Settings > Houses**): at install time, Gladys asks you to allow access to
the location of the houses.

- Each **located** house shows up as a device in the **Discovery** tab.
- Add **only** the houses that have solar panels: only those are queried (no
  request wasted).
- A house without location does not show up: set its location in Gladys,
  then run a discovery again.

## What you get

For each added house, one **Solar forecast** device with 4 sensors:

| Sensor                           | Unit | Content                                   |
| -------------------------------- | ---- | ----------------------------------------- |
| Estimated power now              | W    | Estimated power right now                 |
| Estimated energy today           | kWh  | Estimated production for the whole day    |
| Estimated energy remaining today | kWh  | Estimated production until the end of day |
| Estimated energy tomorrow        | kWh  | Estimated production for tomorrow         |

These are **forecasts**, not measurements: they are not counted in the Gladys
energy monitoring.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Describe your panels:
   - **Tilt**: 0° = flat, 90° = vertical (often 30 to 35° on a roof);
   - **Orientation**: 0° = south, -90° = east, 90° = west, 180° = north;
   - **Peak power** in kWp (written on your contract or inverter).
3. The **API key** is optional: leave it empty for the free plan.
4. Save, then add the device of your house from the **Discovery** tab.

These settings apply to every added house.

The **Refresh the forecast now** button downloads the forecast right away and
shows a summary for today and tomorrow.

## Dashboard widgets

| Widget                   | Content                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| **Solar forecast**       | Power now, energy today / remaining / tomorrow, power curve, peak |
| **Best solar time slot** | Best moment to run an appliance of N hours, today and tomorrow    |

In the widget, choose the device (the house) and, for the best slot, the
appliance duration (washing machine 2 h, dishwasher 3 h…).

## Scenes

### Triggers

| Trigger                 | When                                    |
| ----------------------- | --------------------------------------- |
| Solar forecast updated  | Each time a new forecast is downloaded  |
| Solar production starts | Estimated start of production (sunrise) |
| Solar production peak   | Estimated production peak of the day    |
| Solar production ends   | Estimated end of production (sunset)    |

Optional filter on the house (empty = any). Variables available to the next
actions: house, power now, energy today, remaining, tomorrow, peak power and
time.

For a **threshold** ("if tomorrow > 10 kWh"), use the standard Gladys
"device value" trigger on the "Estimated energy tomorrow" sensor.

### Actions

| Action                             | Parameters           | Results                                                  |
| ---------------------------------- | -------------------- | -------------------------------------------------------- |
| Read the solar forecast            | house                | power, energy today / remaining / tomorrow, peak         |
| Solar production in the next hours | house, hours         | energy (kWh), average and maximum power (W)              |
| Find the best solar time slot      | house, duration, day | found, start / end time, energy, minutes until the start |

Example: every morning at 8 a.m., "Find the best solar time slot" (2 h,
today), then wait "minutes until the start" and start the washing machine.

## How it works

- The forecast is downloaded every 60 minutes by default (15 to 1440
  minutes), per added house.
- Between two downloads, the values are recomputed and published every
  5 minutes (the power follows the sun curve).
- The free plan allows **12 requests per hour** per IP address. On an error
  or when the limit is reached, the integration retries 15 minutes later and
  keeps the last known forecast.
- Houses are read again at every start, every discovery and every hour.
- One plane of panels per house. For an east/west installation, enter the
  orientation and peak power of the main plane.

## Troubleshooting

- **"Configuration incomplete or invalid"**: a required field is empty or out
  of range (the field name is given).
- **"No house with a location"**: set the location of a house in
  **Settings > Houses**.
- **"Forecast.Solar request limit reached"**: too many requests from your IP
  address. Raise the refresh interval.
- For details, read the integration logs from Gladys (or `docker logs` on the
  host) with `LOG_LEVEL=debug`.
