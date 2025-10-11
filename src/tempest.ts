/* eslint-disable @typescript-eslint/no-explicit-any */

import { Logger } from 'homebridge';
import axios, { AxiosInstance } from 'axios';
import * as dgram from 'dgram';
import https from 'https';

/* ---------------------------------- */
/* Axios client                                                            */
/* ---------------------------------- */

const http: AxiosInstance = axios.create({
  baseURL: 'https://swd.weatherflow.com/swd/rest',
  timeout: 10_000,
  httpsAgent: new https.Agent({ keepAlive: true }),
  validateStatus: (s) => s >= 200 && s < 300,
});

/* ---------------------------------- */
/* Types                                                                    */
/* ---------------------------------- */

export interface Observation {
  // temperature sensors
  air_temperature: number; // C
  feels_like: number; // C
  wind_chill: number; // C
  dew_point: number; // C

  // humidity sensor
  relative_humidity: number; // %

  // fan and motion sensor
  wind_avg: number; // m/s
  wind_gust: number; // m/s

  // occupancy sensors
  barometric_pressure: number; // mbar
  precip: number; // mm/min
  precip_accum_local_day: number; // mm
  wind_direction: number; // deg
  solar_radiation: number; // W/m^2
  uv: number; // Index

  // light
  brightness: number; // Lux

  // strikes
  lightning_strike_last_epoch: number; // seconds
  lightning_strike_last_distance: number; // km
}

/* Minimal API response shapes we actually read */
type StationObsResponse = {
  obs?: unknown[];
};

type DeviceObsResponse = {
  obs?: unknown[][];
};

type StationsResponse = {
  stations?: Array<{
    devices?: Array<{
      device_id: number;
    }>;
  }>;
};

/* ---------------------------------- */
/* Math helpers                                                             */
/* ---------------------------------- */

const mphFromMS = (ms: number) => ms * 2.2369;
const fToC = (f: number) => (f - 32) * (5 / 9);
const cToF = (c: number) => c * (9 / 5) + 32;
const toNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* ---------------------------------- */
/* UDP Socket: Tempest LAN packets                                         */
/* ---------------------------------- */

export class TempestSocket {
  private readonly log: Logger;
  private readonly s: dgram.Socket;
  private data: Observation;
  private tempest_battery_level = 0;

  constructor(log: Logger, reuse_address: boolean) {
    this.log = log;

    this.data = {
      air_temperature: 0,
      feels_like: 0,
      wind_chill: 0,
      dew_point: 0,
      relative_humidity: 0,
      wind_avg: 0,
      wind_gust: 0,
      barometric_pressure: 0,
      precip: 0,
      precip_accum_local_day: 0,
      wind_direction: 0,
      solar_radiation: 0,
      uv: 0,
      brightness: 0,
      lightning_strike_last_epoch: 0,
      lightning_strike_last_distance: 0,
    };

    this.s = dgram.createSocket({ type: 'udp4', reuseAddr: reuse_address });
    this.log.info('TempestSocket initialized.');
  }

  public start(address = '0.0.0.0', port = 50222) {
    this.setupSocket(address, port);
    this.setupSignalHandlers();
  }

  private setupSocket(address: string, port: number) {
    this.s.bind({ address, port });

    this.s.on('listening', () => {
      this.s.setBroadcast(true);
      const addr = this.s.address();
      this.log.info(`UDP listening on ${typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`}`);
    });

    this.s.on('message', (msg) => {
      try {
        const json = msg.toString('utf-8');
        const data = JSON.parse(json);
        this.processReceivedData(data);
      } catch (error) {
        this.log.warn('Failed to parse UDP JSON payload');
        this.log.error(String(error));
      }
    });

    this.s.on('error', (err) => {
      this.log.error(`Socket error: ${String(err)}`);
    });
  }

  private processReceivedData(data: any) {
    // Only handle the two message kinds we care about
    const t = data?.type;

    if (t === 'obs_st') {
      this.setTempestData(data);
    } else if (t === 'evt_strike') {
      this.appendStrikeEvent(data);
    }
  }

  private setTempestData(event: any): void {
    const obs = Array.isArray(event?.obs) ? event.obs[0] : undefined;
    if (!obs || !Array.isArray(obs)) {
      return;
    }

    // Indices follow WeatherFlow Tempest UDP spec for obs_st frames.
    // wind lull: obs[1] unused
    const windAvgMS = toNum(obs[2], 0);
    const windGustMS = toNum(obs[3], 0);
    const windDir = toNum(obs[4], 0);
    const pressure = toNum(obs[6], 0);
    const tempC = toNum(obs[7], 0);
    const rh = toNum(obs[8], 0);
    const brightness = toNum(obs[9], 0);
    const uv = toNum(obs[10], 0);
    const solar = toNum(obs[11], 0);
    const precip = toNum(obs[12], 0);
    // battery voltage at obs[16]
    const battV = toNum(obs[16], 0);

    // Derived values
    const windMph = mphFromMS(windAvgMS);
    const tF = cToF(tempC);

    // NOAA heat index formula (F)
    const heatIndexF =
      -42.379 +
      2.04901523 * tF +
      10.14333127 * rh -
      0.22475541 * tF * rh -
      0.00683783 * tF * tF -
      0.05481717 * rh * rh +
      0.00122874 * tF * tF * rh +
      0.00085282 * tF * rh * rh -
      0.00000199 * tF * tF * rh * rh;

    // Feels like defined in 80..110 F range, else use T
    const feelsLikeF = tF >= 80 && tF <= 110 ? heatIndexF : tF;

    // Wind chill only for wind > 3 mph and T < 50 F, else T
    const windChillF =
      windMph > 3 && tF < 50
        ? 35.74 + 0.6215 * tF - 35.75 * Math.pow(windMph, 0.16) + 0.4275 * tF * Math.pow(windMph, 0.16)
        : tF;

    // Populate snapshot
    this.data.air_temperature = tempC;
    this.data.feels_like = fToC(feelsLikeF);
    this.data.wind_chill = fToC(windChillF);
    this.data.dew_point = tempC - (100 - rh) / 5.0; // Td ≈ T - ((100 - RH)/5)
    this.data.relative_humidity = rh;
    this.data.wind_avg = windAvgMS;
    this.data.wind_gust = windGustMS;
    this.data.barometric_pressure = pressure;
    this.data.precip = precip;
    this.data.precip_accum_local_day = precip; // if you store day accum separately, map the correct index here
    this.data.wind_direction = windDir;
    this.data.solar_radiation = solar;
    this.data.uv = uv;
    this.data.brightness = brightness;

    // Battery: 2.80V = 100%, 1.80V = 0%
    this.tempest_battery_level = Math.round((battV - 1.8) * 100);
  }

  private appendStrikeEvent(data: any): void {
    const evt = Array.isArray(data?.evt) ? data.evt : undefined;
    if (!evt) {
      return;
    }

    this.data.lightning_strike_last_epoch = toNum(evt[0], 0);
    this.data.lightning_strike_last_distance = toNum(evt[1], 0);
  }

  private setupSignalHandlers(): void {
    const shutdown = (sig: string) => {
      this.log.info(`Got ${sig}, shutting down Tempest Homebridge...`);
      try {
        this.s.close();
      } catch (e) {
        this.log.error(String(e));
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  public hasData(): boolean {
    return !!this.data;
  }

  public getStationCurrentObservation(): Observation {
    return this.data;
  }

  public getBatteryLevel(): number {
    return this.tempest_battery_level;
  }
}

/* ---------------------------------- */
/* Cloud API client                                                        */
/* ---------------------------------- */

export class TempestApi {
  private readonly log: Logger;
  private readonly token: string;
  private readonly station_id: string;
  private data: object | undefined;
  private tempest_device_id = 0;
  private tempest_battery_level = 0;
  private readonly max_retries = 30;

  constructor(token: string, station_id: string, log: Logger) {
    this.log = log;
    this.token = token;
    this.station_id = station_id;
    this.data = undefined;

    this.log.info('TempestApi initialized.');
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  private async getStationObservation(): Promise<object | undefined> {
    try {
      const res = await http.get<StationObsResponse>(`/observations/station/${this.station_id}`, {
        headers: this.authHeaders(),
      });

      const obsArray = (res.data as any)?.obs;
      if (Array.isArray(obsArray) && obsArray.length > 0) {
        return obsArray[0]; // return single observation block
      }

      this.log.warn('Response missing "obs" array.');
      return undefined;
    } catch (e) {
      this.log.warn(`[WeatherFlow] ${String(e)}`);
      return undefined;
    }
  }

  public async getStationCurrentObservation(retry_count = 0): Promise<object | undefined> {
    if (retry_count >= this.max_retries) {
      this.log.error(`Reached max API retries: ${this.max_retries}. Stopping.`);
      return this.data;
    }

    const observation = await this.getStationObservation();

    if (!observation) {
      if (this.data) {
        this.log.warn('Returning last cached response.');
        return this.data;
      }

      const attempt = retry_count + 1;
      this.log.warn(`Retrying ${attempt} of ${this.max_retries}. No cached "obs" data.`);
      await this.delay(1000 * attempt);
      return this.getStationCurrentObservation(attempt);
    }

    this.data = observation;
    return this.data;
  }

  public async getTempestBatteryLevel(device_id: number): Promise<number> {
    try {
      const res = await http.get<DeviceObsResponse>(`/observations/device/${device_id}`, {
        headers: this.authHeaders(),
      });

      const firstObs = res.data?.obs?.[0];
      const voltage = toNum(firstObs?.[16], NaN);
      if (Number.isFinite(voltage)) {
        this.tempest_battery_level = Math.round((voltage - 1.8) * 100);
      } else {
        this.log.warn('Battery voltage missing in device observation.');
      }
    } catch (e) {
      this.log.warn(`[WeatherFlow] ${String(e)}`);
    }

    return this.tempest_battery_level;
  }

  public async getTempestDeviceId(): Promise<number> {
    try {
      const res = await http.get<StationsResponse>(`/stations/${this.station_id}`, {
        headers: this.authHeaders(),
      });

      // assumes single hub with single Tempest station, device[1] is the Tempest
      const id = res.data?.stations?.[0]?.devices?.[1]?.device_id;
      if (typeof id === 'number') {
        this.tempest_device_id = id;
      } else {
        this.log.warn('Could not locate Tempest device_id from stations response.');
      }
    } catch (e) {
      this.log.warn(`[WeatherFlow] ${String(e)}`);
    }

    return this.tempest_device_id;
  }
}
