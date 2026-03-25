# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/).

## v5.0.1
* Centralized polling: added a wirePollingCharacteristic helper that wires onGet, sets the initial value, and updates on an interval. This removed a lot of repeated setInterval and updateValue code.
* Small utilities: added clamp, toNum (safe numeric parsing), and mphFromMS so conversions and bounds are clearer and consistent.
* Stronger typing and logs: imported CharacteristicValue, standardized debug logs in each onGet, and wrapped interval updates in try/catch to avoid silent failures.
* Consistent bounds and units:
* Temperature, lux, humidity, battery now clamp and log at limits in one place.
* Motion/wind uses a single rounding path and unit conversion with clear metric vs imperial handling.
* Fan maps wind speed to a percent with explicit caps (0..45 m/s or 0..100 mph) and logs when clamped.
* Occupancy cleanup:
* Extracted a refresh() that sets both the accessory Name (with live reading) and OccupancyDetected.
* Simplified unit/format logic, including a compact wind-direction lookup table.
* Normalized negative values to zero with a single debug.
* Contact sensor polish: kept the 1s ticker and 5s auto-reset but guarded the loop with try/catch and simplified the epoch/distance checks.
* Accessory metadata: left behavior the same, but made the routing class a bit tighter and consistent with the new helpers.
* Fewer magic numbers: grouped conversions, used shared helpers, and removed repeated literals where possible.
* Created a shared Axios client (http) with base URL, 10 s timeout, keep-alive agent, and unified status validation
* Added TypeScript interfaces for API responses (StationObsResponse, DeviceObsResponse, StationsResponse)
* Introduced utility helpers:
* toNum() – safe numeric parsing
* mphFromMS() – convert m/s → mph
* cToF() / fToC() – temperature conversions
* Rewrote UDP socket setup for clarity and stability
* Logs bound address/port on listen
* Centralized error handling and JSON parsing
* Safe guards for invalid or malformed UDP packets
* Simplified heat index and wind-chill calculations using descriptive variable names
* Improved battery percentage formula readability (2.8 V = 100%, 1.8 V = 0%)
* Added consistent unit annotations and inline comments across all observation fields
* Consolidated signal-handler logic (SIGINT, SIGTERM) into a single reusable shutdown handler
* Improved retry mechanism in getStationCurrentObservation() with capped recursion and delay back-off
* Replaced .then()/.catch() chains with modern async/await + try/catch syntax
* Added authHeaders() helper for consistent Bearer token usage
* Unified logging style (info, warn, error) with clearer, contextual messages
* Ensured all network and UDP operations are gracefully recoverable on error
* Enforced strict typing and removed implicit any usage
* Cleaned up redundant comments and ESLint suppressions
* Improved readability, type safety, and maintainability without changing runtime behavior
* Added configurable UDP port via new optional `local_api_port` setting (defaults to `50222`). Useful for Docker containers, port forwarding, and UDP relay setups.
* Added firewall configuration documentation to README for Linux (ufw, firewalld, iptables), macOS, and Docker.
* Added same-subnet/VLAN networking requirement note for Local API users.
* Log the configured UDP port on startup when using Local API.
* Added periodic warning when no UDP data is received during initial startup (every 90 seconds) with troubleshooting hints.
* Added stale data detection: warns if no broadcast received in over 3 minutes after initial connection.

## v4.2.0
* Added the Lightning Strike Contact Sensor, allowing configuration of both the minimum distance and time thresholds for triggering CONTACT_NOT_DETECTED.
* Added option for node "^22.10.0" in `package.json` and `package-lock.json`.

## v4.1.1
* Update README.md to correctly display "Tempest" logo.
* Update README.md to include `station_id` in "Local API Config Example".
* Added _optional_ multicast enablement with dgram socket reuseAddr. Will reuse the address, even if another process has already bound a socket on it, but only one socket can receive the data.
* Added new optional configuration `local_api_shared` to support turning on the above.

## v4.1.0
* Confirm plug-in operation with Homebridge 2.0.0. Updated package.json per homebridge instructions.
* Update `config.schema.json` to require `station_id` for both `http_api` and `local_api`. Update associated code in `platform.ts`.
* Update `@types/node` to "^22.0.0"
* Update `@typescript-eslint/eslint-plugin` to "^8.0.0"
* Update `@typescript-eslint/parser` to "^8.0.0"
* Update `eslint` to "^9.0.0".
* Update `rimraf` to "^6.0.1"
* Update `axios` to "1.7.7

## v4.0.2
* When using HTTP API, check that `token` and `station_id` are present and have valid characteristics.
* When Local API is used, `token` and `station_id` are not required and are not validated. 
* User is able to switch between HTTP API to Local API and back to HTTP API without the need to re-enter `token` and `station_id` as these are retained in the config.sys file.

## v4.0.1
* Check that `station_id` length is more than one character when initializing plugin in Local API mode.
* Update axios to v1.6.2 to address moderate severity vulnerability.

## v4.0.0
* Added Local UDP API support! Now you can choose to listen to your Weather Stations observations directly over your local network. No Station ID or API Token needed. 
    * To use the local API add `local_api`: `true` or `false` to your top level configuration. 
    * Observations are broadcasted every 60 seconds. 
    * Leverages the `obs_st` message. See [documentation](https://weatherflow.github.io/Tempest/api/udp/v171/) for more information.
    * `precip_accum_local_day` not available with local API

## v3.0.3
* Update node-version: [18.x, 20.x], remove 16.x which is no longer supported by homebridge.
* Reformated `getStationObservation()` and `getStationCurrentObservation()` in `tempestApi.ts`.
* Addresses `observation_data is undefined, skipping update` error in `platform.ts` polling loop.

## v3.0.2
* Update node-version: [16.x, 18.x, 20.x], remove 14.x which is no longer supported by homebridge.
* Update `devDependencies` and `dependencies` to latest versions. Update/lock `axios` to version `1.5.1`.
* Updates to `tempestApi.ts`:
  * Add `import https from 'https';`
  * Add `axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });`
  * Add `axios.defaults.timeout = 10000;`
  * Add explicit `Promise` returns to `getStationObservation`
  * Change `validateStatus` from `<500` to `>= 200 && status < 300` for `axios.get` calls
  * Delete `isResponseGood` function as additional `obs` parsing is not required.
  * Refactor `getStationCurrentObservation` so that retry loop is executed.
* Updates to `package.ts`:
  * Revise `setInterval` loop to make use of `async/await`.

## v3.0.1
* Update `config.schema.json` to include sensor `name` field.
* Add cautionary note to `README.md` when upgrading from a previous version of the plugin.

## v3.0.0
* New version providing additional functionality using `occupancy sensors` to display the Tempest sensor values. <br><u>NOTE:</u> There is a current limitation as HomeKit accessory names are set when the accessory is initially added and cannot be dynamically updated. The accessories are correctly displayed and updated in the Homebridge "Accessories" tab of the webpage interface. This version is not backwards compatible.

* Update supported `node-versions` to `[14.x, 16.x, 18.x]` in per homebridge guidelines.
* Add functionality to unregister deleted or renamed sensors. Renamed sensors will be added as new sensor and prior version deleted.

* Add `barometric_pressure`, `precip`, `precip_accum_local_day`, `solar radiation` and `uv` as `occupancy sensors` which display the numerical value of the characteristic as part of the occupancy sensor name. Trip levels can be set for each occupancy sensor.
* Add battery level to `air_temperature` Temperature sensor.
* Change PlatformAccessory SerialNumber from `000` to `station_id`.
* Correct occupancy sensor units. REST API reports in metric, plug-in displays in standard units.
* Correct `fan` speed units and calculation to round the `wind_avg` value rather than truncate to improve reporting of wind speed.
* Revise `platform.ts` and `tempestApi.ts` to determine `tempest_device_id` once on plugin startup.
* Update `platformAccessory.ts` to use `sensor_properties.value_key` for each sensor type.

* Update `config.schema.json` with new functionality to provide drop-down for available `value_key` options that are associated with the `sensor_type`. Add option to display metric or standard units for barometric, wind, and precipitation sensors. Note that C/F preference is set by Homebridge UI or HomeKit settings.
* Ensure that any `config.schema.json` changes are picked up during plugin startup and `accessory.context` is updated.

* Update `README.md` with new functionality, clarifying `sensor_type` and associated `value_key` options, provide typical trip values, and to provide additional details and `occupancy_sensor` limitations.

* Add screenshots folder and content for Wiki.

## v2.0.1
Updates to address runtime errors:
* `platform.ts`:
  * Add check in sampling loop for undefined `observation_data`.
  * Add explicit `promise` return types.
  * Add `wind_chill` and `dew_point` to `observation_data` as additional temperature `characteristics`.
* `platformAccessory.ts`:
  * Add maximum check of `100000` in `getCurrentLux` function.
* `tempestApi.ts`:
  * Add server status checking to `getStationObservation` function.
  * Change `public async getStationCurrentObservation(retry_count = 0)` to `public async getStationCurrentObservation(retry_count: number)` and update function calls in `platform.ts` to start the loop at `0`.
  * Make explicit `retry_count` incrementing.
  * Add `wind_chill` and `dew_point` to `observation_data` as additional temperature `characteristics`.

Additional updates:
* `package.json`:
  * Update `axios` to latest version.
  * Add additional `keywords`.
* Add `CHANGELOG.md` file.
