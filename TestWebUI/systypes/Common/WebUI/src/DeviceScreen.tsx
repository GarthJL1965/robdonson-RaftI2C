
import React, { useEffect, useState } from 'react';
import { DeviceState } from './DeviceStates';
import DeviceAttrsForm from './DeviceAttrsForm';
import DeviceLineChart from './DeviceLineChart';
import './styles.css';
import { DeviceManager } from './DeviceManager';
import DeviceCmdsForm from './DeviceActionsForm';

const deviceManager = DeviceManager.getInstance();

export interface DeviceScreenProps {
    deviceKey: string;
    lastUpdated: number;
}

const DeviceScreen = ({ deviceKey, lastUpdated }: DeviceScreenProps) => {

    const data: DeviceState = deviceManager.getDeviceState(deviceKey);

    // Gray out the device screen if the device is offline
    const offlineClass = data.deviceIsOnline ? '' : 'offline';

    const [timedChartUpdate, setTimedChartUpdate] = useState<number>(0);

    useEffect(() => {
      const startTime = Date.now();
      const updateChart = () => {
        setTimedChartUpdate(Date.now());
        // console.log(`Updating chart time now is ${Date.now()-startTime}`);
      };
      const updateTimer = setInterval(updateChart, 500);
      return () => clearInterval(updateTimer);
    }, []);

    return (
      <div className={`device-screen ${offlineClass}`}>
        <div className="device-block-heading">
          <div className="device-block-heading-text">Device {data.deviceTypeInfo.name} Address {deviceKey}</div>
        </div>
        <div className="device-block-data">
          {/* <p>Data: {JSON.stringify(data)}</p> */}
          <div className="device-attrs-and-actions">
            <DeviceAttrsForm deviceKey={deviceKey} lastUpdated={lastUpdated} />
            <DeviceCmdsForm deviceKey={deviceKey} />
          </div>
          <DeviceLineChart deviceKey={deviceKey} lastUpdated={timedChartUpdate} />
        </div>
      </div>
    );
  };
  
export default DeviceScreen;
