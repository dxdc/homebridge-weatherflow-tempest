import { Service, PlatformAccessory, CharacteristicValue, WithUUID } from 'homebridge';
import { WeatherFlowTempestPlatform } from './platform';

/**
 * Small utils
 */
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const toNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const mphFromMS = (ms: number) => ms * 2.236936;

/**
 * Centralized polling helper to remove repetitive setInterval and updateValue boilerplate.
 * It wires up onGet handler, sets an initial value, and keeps the characteristic fresh.
 */
function wirePollingCharacteristic(
  platform: WeatherFlowTempestPlatform,
  service: Service,
  char: WithUUID<any>,
  getter: () => CharacteristicValue,
) {
  service.getCharacteristic(char).onGet(() => {
    platform.log.debug(`Triggered GET ${char.UUID}`);
    return getter();
  });

  // set initial
  service.getCharacteristic(char).updateValue(getter());

  // poll
  const intervalMs = (platform.config.interval as number || 10) * 1000;
  setInterval(() => {
    try {
      service.getCharacteristic(char).updateValue(getter());
    } catch (e) {
      platform.log.error(String(e));
    }
  }, intervalMs);
}

/**
 * Temperature
 */
class TemperatureSensor {
  private service: Service;

  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor);

    wirePollingCharacteristic(
      this.platform,
      this.service,
      this.platform.Characteristic.CurrentTemperature,
      () => this.getCurrentTemperature(),
    );
  }

  private getCurrentTemperature(): number {
    try {
      const key: string = this.accessory.context.device.temperature_properties.value_key;
      const c = toNum(this.platform.observation_data[key], -270);
      if (c > 100) {
        this.platform.log.debug(`WeatherFlow Tempest temp > 100C: ${c}C`);
        return 100;
      }
      if (c < -271) {
        this.platform.log.debug(`WeatherFlow Tempest temp < -271C: ${c}C`);
        return -271;
      }
      return c;
    } catch (e) {
      this.platform.log.error(String(e));
      return -270;
    }
  }
}

/**
 * Light
 */
class LightSensor {
  private service: Service;

  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.LightSensor) ||
      this.accessory.addService(this.platform.Service.LightSensor);

    wirePollingCharacteristic(
      this.platform,
      this.service,
      this.platform.Characteristic.CurrentAmbientLightLevel,
      () => this.getCurrentLux(),
    );
  }

  private getCurrentLux(): number {
    try {
      const key: string = this.accessory.context.device.light_properties.value_key;
      const lux = toNum(this.platform.observation_data[key], 0.0001);
      if (lux < 0.0001) {
        this.platform.log.debug(`WeatherFlow Tempest lux < 0.0001: ${lux}`);
        return 0.0001;
      }
      if (lux > 100000) {
        this.platform.log.debug(`WeatherFlow Tempest lux > 100000: ${lux}`);
        return 100000;
      }
      return lux;
    } catch (e) {
      this.platform.log.error(String(e));
      return 0.0001;
    }
  }
}

/**
 * Humidity
 */
class HumiditySensor {
  private service: Service;

  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor);

    wirePollingCharacteristic(
      this.platform,
      this.service,
      this.platform.Characteristic.CurrentRelativeHumidity,
      () => this.getCurrentRelativeHumidity(),
    );
  }

  private getCurrentRelativeHumidity(): number {
    try {
      const key: string = this.accessory.context.device.humidity_properties.value_key;
      const rh = Math.round(toNum(this.platform.observation_data[key], 0));
      if (rh > 100) {
        this.platform.log.debug(`WeatherFlow Tempest RH > 100%: ${rh}%`);
        return 100;
      }
      if (rh < 0) {
        this.platform.log.debug(`WeatherFlow Tempest RH < 0%: ${rh}%`);
        return 0;
      }
      return rh;
    } catch (e) {
      this.platform.log.error(String(e));
      return 0;
    }
  }
}

/**
 * Motion (wind as motion)
 */
class MotionSensor {
  private service: Service;

  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    wirePollingCharacteristic(
      this.platform,
      this.service,
      this.platform.Characteristic.MotionDetected,
      () => this.isMotionDetected(),
    );
  }

  private windSpeedRounded(): number {
    try {
      const key: string = this.accessory.context.device.motion_properties.value_key;
      const ms = toNum(this.platform.observation_data[key], 0);
      const useMetric = this.platform.config.units === 'Metric';
      const speed = useMetric ? Math.round(ms) : Math.round(mphFromMS(ms));
      return Math.max(speed, 0);
    } catch (e) {
      this.platform.log.error(String(e));
      return 0;
    }
  }

  private isMotionDetected(): boolean {
    const current = this.windSpeedRounded();
    let trigger = 1;
    try {
      trigger = this.accessory.context.device.motion_properties.trigger_value;
    } catch (e) {
      this.platform.log.error(String(e));
      this.platform.log.warn('Defaulting to 1 as motion trigger value.');
    }
    return current >= trigger;
  }
}

/**
 * Fan (maps wind speed to RotationSpeed percent)
 */
class Fan {
  private service: Service;

  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.Fan) ||
      this.accessory.addService(this.platform.Service.Fan);

    // keep "On" true so Home shows a live speed
    this.service.setCharacteristic(this.platform.Characteristic.On, true);

    wirePollingCharacteristic(
      this.platform,
      this.service,
      this.platform.Characteristic.RotationSpeed,
      () => this.getCurrentWindSpeedPercent(),
    );
  }

  private getCurrentWindSpeedPercent(): number {
    try {
      const key: string = this.accessory.context.device.fan_properties.value_key;
      const ms = toNum(this.platform.observation_data[key], 0);

      if (this.platform.config.units === 'Metric') {
        // treat m/s range 0..45 as 0..45 percent
        const mps = clamp(Math.round(ms), 0, 45);
        if (mps === 45) {
          this.platform.log.debug(`WeatherFlow Tempest wind > 45 m/s, clamped`);
        }
        return mps;
      } else {
        // treat mph range 0..100 as 0..100 percent
        const mph = clamp(Math.round(mphFromMS(ms)), 0, 100);
        if (mph === 100) {
          this.platform.log.debug(`WeatherFlow Tempest wind > 100 mph, clamped`);
        }
        return mph;
      }
    } catch (e) {
      this.platform.log.error(String(e));
      return 0;
    }
  }
}

/**
 * Occupancy (generic threshold sensor with inline units rendering)
 */
class OccupancySensor {
  private service: Service;

  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.OccupancySensor) ||
      this.accessory.addService(this.platform.Service.OccupancySensor);

    // name + detected state are both polled
    const intervalMs = (this.platform.config.interval as number || 10) * 1000;

    this.service
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(() => this.isOccupancyDetected());

    // initial set
    this.refresh();

    setInterval(() => {
      try {
        this.refresh();
      } catch (e) {
        this.platform.log.error(String(e));
      }
    }, intervalMs);
  }

  private refresh() {
    const sensorName = this.accessory.context.device.name;
    const [value, units, trip] = this.getOccupancySensorValue();

    this.service
      .getCharacteristic(this.platform.Characteristic.Name)
      .updateValue(`${sensorName}: ${value} ${units}`);

    this.service
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .updateValue(value >= trip);
  }

  private getOccupancySensorValue(): [value: number, units: string, trip: number] {
    try {
      const props = this.accessory.context.device.occupancy_properties;
      const key: string = props.value_key;
      let trip = props.trigger_value;
      let value = toNum(this.platform.observation_data[key], 0);
      let units = '';

      if (trip < 0) trip = 0;

      switch (key) {
        case 'barometric_pressure': {
          if (this.platform.config.units === 'Metric') {
            value = Math.round(value * 1000) / 1000;
            units = 'mb';
          } else {
            value = Math.round((value / 33.8638) * 1000) / 1000;
            units = 'inHg';
          }
          break;
        }
        case 'precip': {
          if (this.platform.config.units === 'Metric') {
            value = Math.round(value * 100) / 100;
            units = 'mm/min';
          } else {
            value = Math.round((value * 2.36) * 100) / 100; // mm/min -> in/hr
            units = 'in/hr';
          }
          break;
        }
        case 'precip_accum_local_day': {
          if (this.platform.config.units === 'Metric') {
            value = Math.round(value * 100) / 100;
            units = 'mm';
          } else {
            value = Math.round((value / 25.4) * 100) / 100;
            units = 'in';
          }
          break;
        }
        case 'solar_radiation':
          units = 'W/m\xB2';
          break;
        case 'uv':
          value = Math.round(value * 10) / 10;
          units = ' ';
          break;
        case 'wind_direction': {
          const cat = Math.round((value % 360) / 22.5);
          const dirs = [
            '\xB0 N',
            '\xB0 NNE',
            '\xB0 NE',
            '\xB0 ENE',
            '\xB0 E',
            '\xB0 ESE',
            '\xB0 SE',
            '\xB0 SSE',
            '\xB0 S',
            '\xB0 SSW',
            '\xB0 SW',
            '\xB0 WSW',
            '\xB0 W',
            '\xB0 WNW',
            '\xB0 NW',
            '\xB0 NNW',
            '\xB0 N',
          ];
          units = dirs[clamp(cat, 0, 16)];
          break;
        }
        default:
          break;
      }

      if (value < 0) {
        this.platform.log.debug(`WeatherFlow Tempest ${key} < 0: ${value}`);
        value = 0;
      } else {
        this.platform.log.debug(`WeatherFlow Tempest ${key}: ${value} ${units}, trip: ${trip}`);
      }

      return [value, units, trip];
    } catch (e) {
      this.platform.log.error(String(e));
      return [0, '', 1000];
    }
  }

  private isOccupancyDetected(): boolean {
    const [v, _u, trip] = this.getOccupancySensorValue();
    return v >= trip;
  }
}

/**
 * Contact (uses lightning strike proximity as a momentary contact event)
 */
class ContactSensor {
  private service: Service;
  private state = 0;

  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(() => this.getState());

    // initial value
    this.setCharacteristicState(0); // CONTACT_DETECTED

    // 1s ticker with auto reset every 5s if not detected
    let tick = 0;
    setInterval(() => {
      try {
        tick++;
        if (tick === 5) {
          tick = 0;
          if (this.state === 1) this.setCharacteristicState(0);
        }
        this.setCharacteristicState(this.getState());
      } catch (e) {
        this.platform.log.error(String(e));
      }
    }, 1000);
  }

  private getState(): number {
    try {
      const lastEpoch: number = toNum(this.platform.observation_data.lightning_strike_last_epoch, 0);
      const lastDistance: number = toNum(this.platform.observation_data.lightning_strike_last_distance, 0);
      const triggerDistance: number = toNum(this.accessory.context.device.contact_properties.trigger_distance, 0);
      const now = Math.floor(Date.now() / 1000);

      if (
        lastEpoch > 0 &&
        lastDistance > 0 &&
        lastDistance <= triggerDistance &&
        now - lastEpoch <= 5
      ) {
        return 1; // CONTACT_NOT_DETECTED
      }
      return 0;
    } catch (e) {
      this.platform.log.error(String(e));
      return 0;
    }
  }

  private setCharacteristicState(state: number) {
    this.state = state;
    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .updateValue(state);
  }
}

/**
 * Initialize Tempest Platform Accessory (once)
 */
export class InitWeatherFlowTempestPlatform {
  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WeatherFlow')
      .setCharacteristic(this.platform.Characteristic.Model, 'Tempest')
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        `${this.platform.config.station_id}`,
      );

    // Always expose station battery here
    new BatterySensor(this.platform, this.accessory);
  }
}

/**
 * Battery
 */
class BatterySensor {
  private service: Service;

  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.service =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery, 'Tempest Battery');

    wirePollingCharacteristic(
      this.platform,
      this.service,
      this.platform.Characteristic.BatteryLevel,
      () => this.getCurrentBatteryLevel(),
    );
  }

  private getCurrentBatteryLevel(): number {
    try {
      const lvl = toNum(this.platform.tempest_battery_level, 0);
      if (lvl > 100) {
        this.platform.log.debug(`WeatherFlow Tempest battery > 100%: ${lvl}%`);
        return 100;
      }
      if (lvl < 0) {
        this.platform.log.debug(`WeatherFlow Tempest battery < 0%: ${lvl}%`);
        return 0;
      }
      return lvl;
    } catch (e) {
      this.platform.log.error(String(e));
      return 0;
    }
  }
}

/**
 * Platform Accessory router
 */
export class WeatherFlowTempestPlatformAccessory {
  constructor(
    private readonly platform: WeatherFlowTempestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WeatherFlow')
      .setCharacteristic(
        this.platform.Characteristic.Model,
        `Tempest - ${this.accessory.context.device.name}`,
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        `${this.platform.config.station_id}`,
      );

    switch (this.accessory.context.device.sensor_type) {
      case 'Temperature Sensor':
        new TemperatureSensor(this.platform, this.accessory);
        if (this.accessory.context.device.temperature_properties.value_key === 'air_temperature') {
          new BatterySensor(this.platform, this.accessory);
        }
        break;
      case 'Light Sensor':
        new LightSensor(this.platform, this.accessory);
        break;
      case 'Humidity Sensor':
        new HumiditySensor(this.platform, this.accessory);
        break;
      case 'Motion Sensor':
        new MotionSensor(this.platform, this.accessory);
        break;
      case 'Fan':
        new Fan(this.platform, this.accessory);
        break;
      case 'Occupancy Sensor':
        new OccupancySensor(this.platform, this.accessory);
        break;
      case 'Contact Sensor':
        new ContactSensor(this.platform, this.accessory);
        break;
    }
  }
}
