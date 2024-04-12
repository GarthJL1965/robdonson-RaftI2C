import { DevicesConfig } from "./DevicesConfig";
import { DeviceAttribute, DevicesState, DeviceState, getDeviceKey } from "./DeviceStates";
import { DeviceMsgJson } from "./DeviceMsg";
import { AttrTypeBytes, DeviceTypeInfo, DeviceTypeAttribute } from "./DeviceInfo";

export class DeviceManager {

    // Singleton
    private static _instance: DeviceManager;

    // Test server path
    private _testServerPath = "";

    // Server address
    private _serverAddressPrefix = "";

    // URL prefix
    private _urlPrefix: string = "/api";

    // Device configuration
    private _devicesConfig = new DevicesConfig();

    // Modified configuration
    private _mutableConfig = new DevicesConfig();

    // Config change callbacks
    private _configChangeCallbacks: Array<(config: DevicesConfig) => void> = [];

    // Devices state
    private _devicesState = new DevicesState();

    // Device callbacks
    private _callbackNewDevice: ((deviceKey: string, state: DeviceState) => void) | null = null;
    private _callbackNewDeviceAttribute: ((deviceKey: string, attr: DeviceAttribute) => void) | null = null;
    private _callbackNewAttributeData: ((deviceKey: string, attr: DeviceAttribute) => void) | null = null;

    // Last time we got a state update
    private _lastStateUpdate: number = 0;
    private MAX_TIME_BETWEEN_STATE_UPDATES_MS: number = 60000;

    // Websocket
    private _websocket: WebSocket | null = null;

    // Get instance
    public static getInstance(): DeviceManager {
        if (!DeviceManager._instance) {
            DeviceManager._instance = new DeviceManager();
        }
        return DeviceManager._instance;
    }

    // Constructor
    private constructor() {
        console.log("DeviceManager constructed");

        // Check if test mode
        if (window.location.hostname === "localhost") {
            // Start timer for testing which sends randomized data
            let lastReportTimeMs = 0;
            setInterval(() => {
                const timestamp = (Date.now() * 100) & 0xffff;
                const var1 = Math.floor(Math.random() * 65535);
                const var2 = Math.floor(Math.random() * 65535);
                const var3 = Math.floor(Math.random() * 65535);
                const msg = `{
                    "I2CA":
                        {
                            "0x60@1": {
                                "x": "${timestamp.toString(16).padStart(4, '0')}${var1.toString(16).padStart(4, '0')}${var2.toString(16).padStart(4, '0')}${var3.toString(16).padStart(4, '0')}"
                            }
                        }
                    }`;
                this.handleDeviceMsgJson(msg);
            }, 1000);
        }
    }

    ////////////////////////////////////////////////////////////////////////////
    // Send REST commands
    ////////////////////////////////////////////////////////////////////////////

    async sendCommand(cmd: string): Promise<boolean> {
        try {
            const sendCommandResponse = await fetch(this._serverAddressPrefix + this._urlPrefix + cmd);
            if (!sendCommandResponse.ok) {
                console.log(`DeviceManager sendCommand response not ok ${sendCommandResponse.status}`);
            }
            return sendCommandResponse.ok;
        } catch (error) {
            console.log(`DeviceManager sendCommand error ${error}`);
            return false;
        }
    }

    ////////////////////////////////////////////////////////////////////////////
    // Init
    ////////////////////////////////////////////////////////////////////////////

    public async init(): Promise<boolean> {
        // Check if already initialized
        if (this._websocket) {
            console.log(`DeviceManager init already initialized`)
            return true;
        }
        console.log(`DeviceManager init - first time`)

        await this.getAppSettingsAndCheck();

        const rslt = await this.connectWebSocket();

        // Start timer to check for websocket reconnection
        setInterval(async () => {
            if (!this._websocket) {
                console.log(`DeviceManager init - reconnecting websocket`);
                await this.connectWebSocket();
            }
            else if ((Date.now() - this._lastStateUpdate) > this.MAX_TIME_BETWEEN_STATE_UPDATES_MS) {
                const inactiveTimeSecs = ((Date.now() - this._lastStateUpdate) / 1000).toFixed(1);
                if (this._websocket) {
                    console.log(`DeviceManager init - closing websocket due to ${inactiveTimeSecs}s inactivity`);
                    this._websocket.close();
                    this._websocket = null;
                }
            }
            console.log(`websocket state ${this._websocket?.readyState}`);
        }, 5000);

        return rslt;
    }

    ////////////////////////////////////////////////////////////////////////////
    // Get the configuration from the main server
    ////////////////////////////////////////////////////////////////////////////

    private async getAppSettingsAndCheck(): Promise<boolean> {

        // Get the configuration from the main server
        const appSettingsResult = await this.getAppSettings("");
        if (!appSettingsResult) {
            
            // See if test-server is available
            const appSettingAlt = await this.getAppSettings(this._testServerPath);
            if (!appSettingAlt) {
                console.log("DeviceManager init unable to get app settings");
                return false;
            }
            this._serverAddressPrefix = this._testServerPath;
        }
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////
    // Open websocket
    ////////////////////////////////////////////////////////////////////////////

    private async connectWebSocket(): Promise<boolean> {
        // Open a websocket to the server
        try {
            console.log(`DeviceManager init location.origin ${window.location.origin} ${window.location.protocol} ${window.location.host} ${window.location.hostname} ${window.location.port} ${window.location.pathname} ${window.location.search} ${window.location.hash}`)
            let webSocketURL = this._serverAddressPrefix;
            if (webSocketURL.startsWith("http")) {
                webSocketURL = webSocketURL.replace(/^http/, 'ws');
            } else {
                webSocketURL = window.location.origin.replace(/^http/, 'ws');
            }
            webSocketURL += "/devjson";
            console.log(`DeviceManager init opening websocket ${webSocketURL}`);
            this._websocket = new WebSocket(webSocketURL);
            if (!this._websocket) {
                console.error("DeviceManager init unable to create websocket");
                return false;
            }
            this._websocket.binaryType = "arraybuffer";
            this._lastStateUpdate = Date.now();
            this._websocket.onopen = () => {
                // Debug
                console.log(`DeviceManager init websocket opened to ${webSocketURL}`);

                // Send subscription request messages after a short delay
                setTimeout(() => {

                    // Subscribe to device messages
                    const subscribeName = "devices";
                    console.log(`DeviceManager init subscribing to ${subscribeName}`);
                    if (this._websocket) {
                        this._websocket.send(JSON.stringify({
                            cmdName: "subscription",
                            action: "update",
                            pubRecs: [
                                {name: subscribeName, msgID: subscribeName, rateHz: 0.1},
                            ]
                        }));
                    }
                }, 1000);
            }
            this._websocket.onmessage = (event) => {
                this.handleDeviceMsgJson(event.data);
            }
            this._websocket.onclose = () => {
                console.log(`DeviceManager websocket closed`);
                this._websocket = null;
            }
            this._websocket.onerror = (error) => {
                console.log(`DeviceManager websocket error ${error}`);
            }
        }
        catch (error) {
            console.log(`DeviceManager websocket error ${error}`);
            return false;
        }
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////
    // Config handling
    ////////////////////////////////////////////////////////////////////////////

    // Get the config
    public getConfig(): DevicesConfig {
        return this._devicesConfig;
    }

    // Get mutable config
    public getMutableConfig(): DevicesConfig {
        return this._mutableConfig;
    }

    // Revert configuration
    public revertConfig(): void {
        this._mutableConfig = JSON.parse(JSON.stringify(this._devicesConfig));
        this._configChangeCallbacks.forEach(callback => {
            callback(this._devicesConfig);
        });
    }

    // Persist configuration
    public async persistConfig(): Promise<void> {

        // TODO - change config that needs to be changed
        this._devicesConfig = JSON.parse(JSON.stringify(this._mutableConfig));
        await this.postAppSettings();
    }

    // Check if config changed
    public isConfigChanged(): boolean {
        return JSON.stringify(this._devicesConfig) !== JSON.stringify(this._mutableConfig);
    }

    // Register a config change callback
    public onConfigChange(callback: (config:DevicesConfig) => void): void {
        // Add the callback
        this._configChangeCallbacks.push(callback);
    }

    // Register state change callbacks
    public onNewDevice(callback: (deviceKey: string, state: DeviceState) => void): void {
        // Save the callback
        this._callbackNewDevice = callback;
    }
    public onNewDeviceAttribute(callback: (deviceKey: string, attr: DeviceAttribute) => void): void {
        // Save the callback
        this._callbackNewDeviceAttribute = callback;
    }
    public onNewAttributeData(callback: (deviceKey: string, attr: DeviceAttribute) => void): void {
        // Save the callback
        this._callbackNewAttributeData = callback;
    }
    
    ////////////////////////////////////////////////////////////////////////////
    // Get the app settings from the server
    ////////////////////////////////////////////////////////////////////////////

    async getAppSettings(serverAddr:string) : Promise<boolean> {
        // Get the app settings
        console.log(`DeviceManager getting app settings`);
        let getSettingsResponse = null;
        try {
            getSettingsResponse = await fetch(serverAddr + this._urlPrefix + "/getsettings/nv");
            if (getSettingsResponse && getSettingsResponse.ok) {
                const settings = await getSettingsResponse.json();

                console.log(`DeviceManager getAppSettings ${JSON.stringify(settings)}`)

                if ("nv" in settings) {

                    // Start with a base config
                    const configBase = new DevicesConfig();

                    console.log(`DeviceManager getAppSettings empty config ${JSON.stringify(configBase)}`);

                    // Add in the non-volatile settings
                    this.addNonVolatileSettings(configBase, settings.nv);

                    console.log(`DeviceManager getAppSettings config with nv ${JSON.stringify(configBase)}`);

                    // Extract non-volatile settings
                    this._devicesConfig = configBase;
                    this._mutableConfig = JSON.parse(JSON.stringify(configBase));

                    // Inform screens of config change
                    this._configChangeCallbacks.forEach(callback => {
                        callback(this._devicesConfig);
                    });
                } else {
                    alert("DeviceManager getAppSettings settings missing nv section");
                }
                return true;
            } else {
                alert("DeviceManager getAppSettings response not ok");
            }
        } catch (error) {
            console.log(`DeviceManager getAppSettings ${error}`);
            return false;
        }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////
    // Post applicaton settings
    ////////////////////////////////////////////////////////////////////////////

    async postAppSettings(): Promise<boolean> {
        try {
            const postSettingsURI = this._serverAddressPrefix + this._urlPrefix + "/postsettings/reboot";
            const postSettingsResponse = await fetch(postSettingsURI, 
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(this._devicesConfig).replace("\n", "\\n")
                }
            );

            console.log(`DeviceManager postAppSettings posted ${JSON.stringify(this._devicesConfig)}`)

            if (!postSettingsResponse.ok) {
                console.error(`DeviceManager postAppSettings response not ok ${postSettingsResponse.status}`);
            }
            return postSettingsResponse.ok;
        } catch (error) {
            console.error(`DeviceManager postAppSettings error ${error}`);
            return false;
        }
    }

    ////////////////////////////////////////////////////////////////////////////
    // Add non-volatile settings to the config
    ////////////////////////////////////////////////////////////////////////////

    private addNonVolatileSettings(config:DevicesConfig, nv:DevicesConfig) {
        // Iterate over keys in nv
        let key: keyof DevicesConfig;
        for (key in nv) {
            // Check if key exists in config
            if (!(key in config)) {
                console.log(`DeviceManager addNonVolatileSettings key ${key} not in config`);
                continue;
            }
            Object.assign(config[key], nv[key])
        }
    }

    ////////////////////////////////////////////////////////////////////////////
    // Set the friendly name for the device
    ////////////////////////////////////////////////////////////////////////////

    public async setFriendlyName(friendlyName:string): Promise<void> {
        try {
            await fetch(this._serverAddressPrefix + this._urlPrefix + "/friendlyname/" + friendlyName);
        } catch (error) {
            console.log(`DeviceManager setFriendlyName ${error}`);
        }
    }

    ////////////////////////////////////////////////////////////////////////////
    // Handle device message JSON
    ////////////////////////////////////////////////////////////////////////////

    private handleDeviceMsgJson(jsonMsg: string) {

        // TODO - put back try/catch
        // try {
            let data = JSON.parse(jsonMsg) as DeviceMsgJson;
            console.log(`DeviceManager websocket message ${JSON.stringify(data)}`);

            // Iterate over the buses
            Object.entries(data).forEach(([busName, devices]) => {
                
                // Iterate over the devices
                Object.entries(devices).forEach(([devAddr, msgElem]) => {

                    // Device key
                    const deviceKey = getDeviceKey(busName, devAddr);

                    // Check if a device state already exists
                    if (!(devAddr in this._devicesState)) {
                        // Get the device type info for this device
                        const deviceTypeInfo = this.getDeviceTypeInfo(deviceKey);

                        // Create device record
                        this._devicesState[devAddr] = {
                            deviceTypeInfo: deviceTypeInfo,
                            deviceTimeline: [],
                            deviceAttributes: {},
                            deviceRecordNew: true,
                            deviceStateChanged: false,
                            lastReportTimestampMs: 0,
                            reportTimestampOffsetMs: 0
                        };
                    }
                    
                    // Iterate attribute groups
                    Object.entries(msgElem).forEach(([attrGroup, msgHexStr]) => {

                        // Check valid
                        if ((typeof msgHexStr != 'string') || (msgHexStr.length < 4)) {
                            return;
                        }

                        // Extract timestamp which is the first 2 bytes
                        let timestamp = parseInt(msgHexStr.slice(0, 4), 16);

                        // Check if time is before lastReportTimeMs - in which case a wrap around occurred to add on the max value
                        if (timestamp < this._devicesState[devAddr].lastReportTimestampMs) {
                            this._devicesState[devAddr].reportTimestampOffsetMs += 65536;
                        }
                        this._devicesState[devAddr].lastReportTimestampMs = timestamp;

                        // Offset timestamp
                        const origTimestamp = timestamp;
                        timestamp += this._devicesState[devAddr].reportTimestampOffsetMs;

                        // Check for the attrGroup name in the device type info
                        if (attrGroup in this._devicesState[devAddr].deviceTypeInfo.attr) {

                            // Set device state changed flag
                            this._devicesState[devAddr].deviceStateChanged = true;

                            // Iterate over attributes in the group
                            const devAttrDefinitions: DeviceTypeAttribute[] = this._devicesState[devAddr].deviceTypeInfo.attr[attrGroup];
                            let attrIdx = 0;
                            let hexStrIdx = 4; // TODO - set this to the number of bytes in the timestamp
                            while (hexStrIdx < msgHexStr.length) {
                                if (attrIdx >= devAttrDefinitions.length) {
                                    console.warn(`DeviceManager msg too many attributes attrGroup ${attrGroup} devkey ${deviceKey} msgHexStr ${msgHexStr} ts ${timestamp}`);
                                    break;
                                }
                                const attr: DeviceTypeAttribute = devAttrDefinitions[attrIdx];
                                if (!("t" in attr && attr.t in AttrTypeBytes)) {
                                    console.warn(`DeviceManager msg unknown type ${attr.t} attrGroup ${attrGroup} devkey ${deviceKey} msgHexStr ${msgHexStr} ts ${timestamp} attr ${JSON.stringify(attr)} value ${value}`);
                                    break;
                                }
                                const attrBytes = AttrTypeBytes[attr.t];
                                const attrHexChars = attrBytes * 2;
                                const value = parseInt(msgHexStr.slice(hexStrIdx, hexStrIdx + attrHexChars), 16);
                                console.log(`DeviceManager msg attrGroup ${attrGroup} devkey ${deviceKey} msgHexStr ${msgHexStr} ts ${timestamp} attr ${attr.n} value ${value}`);
                                hexStrIdx += attrHexChars;
                                attrIdx++;

                                // Check if attribute already exists in the device state
                                if (attr.n in this._devicesState[devAddr].deviceAttributes) {
                                    this._devicesState[devAddr].deviceAttributes[attr.n].values.push(value);
                                    this._devicesState[devAddr].deviceAttributes[attr.n].newData = true;
                                } else {
                                    this._devicesState[devAddr].deviceAttributes[attr.n] = {
                                        name: attr.n,
                                        newAttribute: true,
                                        newData: true,
                                        values: [value]
                                    };
                                }
                            }

                            // console.log(`DeviceManager msg attrGroup ${attrGroup} devkey ${deviceKey} msgHexStr ${msgHexStr} ts ${timestamp} data ${JSON.stringify(data)}`);

                            // // Iterate over data
                            // Object.entries(data).forEach(([key, values]) => {
                            //     if (key in this._devicesState[devAddr].deviceAttributes) {
                            //         this._devicesState[devAddr].deviceAttributes[key].values.push(values[0]);
                            //     } else {
                            //         this._devicesState[devAddr].deviceAttributes[key] = {
                            //             name: key,
                            //             values: [values[0]]
                            //         };
                            //     }
                            // });

                            // // Update the state
                            // this._devicesState[devAddr] = {
                            //     ...this._devicesState[devAddr],
                            //     deviceStateChanged: true
                            // };
                            // this._devicesState[devAddr].deviceTimeline.push(timestamp);
                        }

                        // console.log(`DeviceManager msg attrGroup ${attrGroup} devkey ${deviceKey} msgHexStr ${msgHexStr} ts ${timestamp} data ${JSON.stringify(data)}`);




                    //     // Extract the data which is the remaining bytes
                    //     interface AttrDataType {
                    //         [x: string] : number[];
                    //     }
                        
                    //     const data: AttrDataType = {
                    //         x: [parseInt(msgHexStr.slice(4),16)]
                    //     }
                        
                    //     // Check if there is a device state already
                    //     if (devAddr in this._devicesState) {
                            
                    //         // Update the state
                    //         this._devicesState[devAddr] = {
                    //             ...this._devicesState[devAddr],
                    //             deviceStateChanged: true
                    //             }
                    //         }
                    //         this._devicesState[devAddr].deviceTimeline.push(timestamp);
                            
                    //         // Iterate over data
                    //         Object.entries(data).forEach(([key, values]) => {
                    //             if (key in this._devicesState[devAddr].deviceAttributes) {
                    //                 this._devicesState[devAddr].deviceAttributes[key].values.
                    //             } else {
                    //                 this._devicesState[devAddr].deviceAttributes[key] = {
                    //                     name: key,
                    //                     values: [value]
                    //                 };
                    //             }
                    //         });
                    //     }
                    // }

                    });                    
                });
            });
        // } catch (error) {
        //     console.error(`DeviceManager websocket message error ${error} msg ${jsonMsg}`);
        //     return;
        // }

        
        //     Object.entries(devices).forEach(([devAddr, msgElem]) => {
        //       // Transform DeviceMsgJsonElem to DeviceState here
        //       // This is a placeholder transformation. You need to adjust this logic
        //       // based on how you want to interpret the message data (`x`) and convert
        //       // it into `DeviceState`.
        //       const deviceState: DeviceState = {
        //         lastStateChangeTime: Date.now(), // Assuming current time as the last state change
        //         deviceTimeline: [], // You would fill this based on your specific logic
        //         deviceAttributes: [], // Convert `x` or other properties into `DeviceAttribute` array
        //       };
        
        //       devicesState.devices[devAddr] = deviceState;
        //     });
        
        //     busesState.buses[busName] = devicesState;
        //   });

        // // Iterate over the buses
        // let busName: string;
        // for (busName in data) {
        //     // Iterate over the devices
        //     let devAddr: string;
        //     for (devAddr in data[busName]) {
        //         // Get the message data
        //         const msgData = data[busName][devAddr].x;
        //         console.log(`DeviceManager handleDeviceMsgJson bus ${busName} devAddr ${devAddr} msgData ${msgData}`);
        //         // TODO - update the state
        //     }
        // }

        // Update the last state update time
        this._lastStateUpdate = Date.now();

        // Process the callback
        this.processStateCallback();

    }

    private processStateCallback() {

        // Iterate over the devices
        Object.entries(this._devicesState).forEach(([deviceKey, deviceState]) => {
            
            // Check if device record is new
            if (deviceState.deviceRecordNew) {
                if (this._callbackNewDevice) {
                    this._callbackNewDevice(
                        deviceKey,
                        deviceState
                    );
                }
                deviceState.deviceRecordNew = false;
            }

            // Iterate over the attributes
            Object.entries(deviceState.deviceAttributes).forEach(([attrKey, attr]) => {
                if (attr.newAttribute) {
                    if (this._callbackNewDeviceAttribute) {
                        this._callbackNewDeviceAttribute(
                            deviceKey,
                            attr
                        );
                    }
                    attr.newAttribute = false;
                }
                if (attr.newData) {
                    if (this._callbackNewAttributeData) {
                        this._callbackNewAttributeData(
                            deviceKey,
                            attr
                        );
                    }
                    attr.newData = false;
                }
            });
        });


        // TODO - improve this - maybe a flag to say which devices have changed 
        // call the _devicesStateCallback on each device
        // Object.entries(this._device).forEach(([deviceKey, deviceConfig]) => {
        //     this._deviceStateCallback(deviceKey, deviceConfig.state);
        // }

        // // Iterate over _deviceStates object
        // let deviceKey: string;
        // for (deviceKey in this._deviceStates) {

        // // Call the callback
        // this._deviceStateCallback(this._devicesConfig);
    }

    ////////////////////////////////////////////////////////////////////////////
    // Get device type info
    ////////////////////////////////////////////////////////////////////////////

    private getDeviceTypeInfo(deviceKey: string): DeviceTypeInfo {
        // TODO - implement this
       if (deviceKey === "I2CA_0x60@1") {
            return {
                "name": "VCNL4040",
                "desc": "Prox&ALS",
                "manu": "Vishay",
                "type": "VCNL4040",
                "attr": {
                    "x" : 
                    [
                        {
                            "n": "prox",
                            "t": "uint16",
                            "u": "mm",
                            "r": [
                                0,
                                65535
                            ],
                            "d": 1
                        },
                        {
                            "n": "als",
                            "t": "uint16",
                            "u": "lux",
                            "r": [
                                0,
                                65535
                            ],
                            "d": 1
                        },
                        {
                            "n": "white",
                            "t": "uint16",
                            "u": "lux",
                            "r": [
                                0,
                                65535
                            ],
                            "d": 1
                        }
                    ]
                }
            }
        } else if (deviceKey === "I2CA_0x1d@1") {
            return {
                "name": "ADXL313",
                "desc": "3-Axis Accel",
                "manu": "Analog Devices",
                "type": "ADXL313",
                "attr": {
                    "x": 
                    [
                        {
                            "n": "x",
                            "t": "uint16",
                            "u": "",
                            "r": [
                                0,
                                65535
                            ],
                            "d": 1
                        },
                        {
                            "n": "y",
                            "t": "uint16",
                            "u": "",
                            "r": [
                                0,
                                65535
                            ],
                            "d": 1
                        },
                        {
                            "n": "z",
                            "t": "uint16",
                            "u": "",
                            "r": [
                                0,
                                65535
                            ],
                            "d": 1
                        }
                    ]
                }
            }
        }

        return {
            "name": "Unknown",
            "desc": "Unknown",
            "manu": "Unknown",
            "type": "Unknown",
            "attr": {}
        };
    }
}
