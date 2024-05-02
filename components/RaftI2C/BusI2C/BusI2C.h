/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// I2C Bus Handler
//
// Rob Dobson 2020
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////

#pragma once

#include "BusBase.h"
#include "RaftI2CCentralIF.h"
#include "BusI2CRequestRec.h"
#include "BusScanner.h"
#include "BusStatusMgr.h"
#include "BusExtenderMgr.h"
#include "BusAccessor.h"
#include "DeviceIdentMgr.h"
#include "DevicePollingMgr.h"
#include "BusPowerController.h"
#include "BusStuckHandler.h"

// #define DEBUG_RAFT_BUSI2C_MEASURE_I2C_LOOP_TIME

class RaftI2CCentralIF;

class BusI2C : public BusBase
{
public:
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Constructor
    /// @param busElemStatusCB - callback for bus element status changes
    /// @param busOperationStatusCB - callback for bus operation status changes
    /// @param pI2CCentralIF - pointer to I2C central interface (if nullptr then use default I2C interface)
    BusI2C(BusElemStatusCB busElemStatusCB, BusOperationStatusCB busOperationStatusCB,
                RaftI2CCentralIF* pI2CCentralIF = nullptr);

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Destructor
    virtual ~BusI2C();

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Create function to create a new instance of this class
    /// @param busElemStatusCB - callback for bus element status changes
    /// @param busOperationStatusCB - callback for bus operation status changes
    static BusBase* createFn(BusElemStatusCB busElemStatusCB, BusOperationStatusCB busOperationStatusCB)
    {
        return new BusI2C(busElemStatusCB, busOperationStatusCB);
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief setup
    /// @param config - configuration
    /// @return true if setup was successful
    virtual bool setup(const RaftJsonIF& config) override final;

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Close bus
    virtual void close() override final;

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief service (should be called frequently to service the bus)
    virtual void service() override final;

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief clear response queue (and optionally clear polling data)
    /// @param incPolling - clear polling data
    virtual void clear(bool incPolling) override final;

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief pause or resume bus
    /// @param pause - true to pause, false to resume
    virtual void pause(bool pause) override final
    {
        // Set pause flag - read in the worker
        _pauseRequested = pause;

        // Suspend bus accessor
        _busAccessor.pause(pause);
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief isPaused
    /// @return true if the bus is paused
    virtual bool isPaused() const override final
    {
        return _isPaused;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Hiatus for a period in ms (stop bus activity for a period of time)
    /// @param forPeriodMs - period in ms
    virtual void hiatus(uint32_t forPeriodMs) override final;

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief isHiatus
    /// @return true if the bus is in hiatus
    virtual bool isHiatus() const override final
    {
        return _hiatusActive;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Get bus name
    /// @return bus name
    virtual String getBusName() const override final
    {
        return _busName;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief isOperatingOk
    /// @return true if the bus is operating OK
    virtual BusOperationStatus isOperatingOk() const override final
    {
        return _busStatusMgr.isOperatingOk();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Request an action (like regular polling of a device or sending a single message and getting a response)
    /// @param busReqInfo - bus request information
    /// @return true if the request was added
    virtual bool addRequest(BusRequestInfo& busReqInfo) override final
    {
        return _busAccessor.addRequest(busReqInfo);
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Check if an element is responding
    /// @param address - address of element
    /// @param pIsValid - (out) true if the address is valid
    /// @return true if the element is responding
    virtual bool isElemResponding(uint32_t address, bool* pIsValid) const override final;

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Request a change to bus scanning activity
    /// @param enableSlowScan - true to enable slow scan, false to disable
    /// @param requestFastScan - true to request a fast scan
    virtual void requestScan(bool enableSlowScan, bool requestFastScan) override final;

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Get device type information by address
    /// @param address - address of device to get information for
    /// @param includePlugAndPlayInfo - true to include plug and play information
    /// @return JSON string
    virtual String getDevTypeInfoJsonByAddr(uint32_t address, bool includePlugAndPlayInfo) const override final;

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Get device type information by device type name
    /// @param deviceType - device type name
    /// @param includePlugAndPlayInfo - true to include plug and play information
    /// @return JSON string
    virtual String getDevTypeInfoJsonByTypeName(const String& deviceType, bool includePlugAndPlayInfo) const override final;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Return addresses of devices attached to the bus
    /// @param addresses - vector to store the addresses of devices
    /// @param onlyAddressesWithIdentPollResponses - true to only return addresses with ident poll responses
    /// @return true if there are any ident poll responses available
    virtual bool getBusElemAddresses(std::vector<uint32_t>& addresses, bool onlyAddressesWithIdentPollResponses) const
    {
        return _busStatusMgr.getBusElemAddresses(addresses, onlyAddressesWithIdentPollResponses);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////    
    /// @brief Get bus element poll responses for a specific address
    /// @param address - address of device to get responses for
    /// @param isOnline - (out) true if device is online
    /// @param deviceTypeIndex - (out) device type index
    /// @param devicePollResponseData - (out) vector to store the device poll response data
    /// @param responseSize - (out) size of the response data
    /// @param maxResponsesToReturn - maximum number of responses to return (0 for no limit)
    /// @return number of responses returned
    virtual uint32_t getBusElemPollResponses(uint32_t address, bool& isOnline, uint16_t& deviceTypeIndex, 
                std::vector<uint8_t>& devicePollResponseData, 
                uint32_t& responseSize, uint32_t maxResponsesToReturn) override final
    {
        return _busStatusMgr.getBusElemPollResponses(address, isOnline, deviceTypeIndex, devicePollResponseData, responseSize, maxResponsesToReturn);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Get time of last bus status update
    /// @return time of last bus status update in ms
    virtual uint32_t getLastStatusUpdateMs(bool includeElemOnlineStatusChanges, bool includePollDataUpdates) const override final
    {
        return _busStatusMgr.getLastStatusUpdateMs(includeElemOnlineStatusChanges, includePollDataUpdates);
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Get bus poll JSON for all detected bus elements
    /// @return JSON string
    virtual String getBusPollResponsesJson() override final
    {
        return _busStatusMgr.getBusPollResponsesJson(_deviceIdentMgr);
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Convert bus address to string
    /// @param addr - address
    /// @return address as a string
    virtual String addrToString(uint32_t addr) const override final
    {
        BusI2CAddrAndSlot addrAndSlot = BusI2CAddrAndSlot::fromCompositeAddrAndSlot(addr);
        return addrAndSlot.toString();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /// @brief Convert string to bus address
    /// @param addrStr - address as a string
    /// @return address
    virtual uint32_t stringToAddr(const String& addrStr) const override final
    {
        BusI2CAddrAndSlot addrAndSlot;
        addrAndSlot.fromString(addrStr);
        return addrAndSlot.toCompositeAddrAndSlot();
    }

    // Yield value on each bus processing loop
    static const uint32_t I2C_BUS_LOOP_YIELD_MS = 5;

    // Max fast scanning without yielding
    static const uint32_t I2C_BUS_FAST_MAX_UNYIELD_DEFAUT_MS = 10;
    static const uint32_t I2C_BUS_SLOW_MAX_UNYIELD_DEFAUT_MS = 2;

private:

    // Settings
    int _i2cPort = 0;
    int _sdaPin = -1;
    int _sclPin = -1;
    uint32_t _freq = 100000;
    uint32_t _i2cFilter = RaftI2CCentralIF::DEFAULT_BUS_FILTER_LEVEL;
    String _busName;

    // I2C device
    RaftI2CCentralIF* _pI2CCentral = nullptr;
    bool _i2cCentralNeedsToBeDeleted = false;

    // Last comms time uS
    uint64_t _lastI2CCommsUs = 0;
    static const uint32_t MIN_TIME_BETWEEN_I2C_COMMS_US = 1000;

    // I2C loop control
    uint32_t _loopFastUnyieldUs = I2C_BUS_FAST_MAX_UNYIELD_DEFAUT_MS * 1000;
    uint32_t _loopSlowUnyieldUs = I2C_BUS_SLOW_MAX_UNYIELD_DEFAUT_MS * 1000;
    uint32_t _loopYieldMs = I2C_BUS_LOOP_YIELD_MS;

    // Init ok
    bool _initOk = false;

    // Task that operates the bus
    volatile TaskHandle_t _i2cWorkerTaskHandle = nullptr;
    static const int DEFAULT_TASK_CORE = 0;
    static const int DEFAULT_TASK_PRIORITY = 5;
    static const int DEFAULT_TASK_STACK_SIZE_BYTES = 10000;
    static const uint32_t WAIT_FOR_TASK_EXIT_MS = 1000;

    // Pause/run status
    volatile bool _pauseRequested = false;
    volatile bool _isPaused = false;

    // Haitus for period of ms (generally due to power cycling, etc)
    volatile bool _hiatusActive = false;
    uint32_t _hiatusStartMs = 0;
    uint32_t _hiatusForMs = 0;
    
    // Measurement of loop time
#ifdef DEBUG_RAFT_BUSI2C_MEASURE_I2C_LOOP_TIME
    uint32_t _i2cDebugLastReportMs = 0;
    uint64_t _i2cLoopWorstTimeUs = 0;
    uint32_t _i2cMainLoopCount = 0;
#endif

    // Bus status
    BusStatusMgr _busStatusMgr;

    // Bus power controller
    BusPowerController _busPowerController;
    
    // Bus stuck handler
    BusStuckHandler _busStuckHandler;
    
    // Bus extender manager
    BusExtenderMgr _busExtenderMgr;

    // Device identifier
    DeviceIdentMgr _deviceIdentMgr;

    // Bus scanner
    BusScanner _busScanner;

    // Device polling manager
    DevicePollingMgr _devicePollingMgr;

    // Bus accessor
    BusAccessor _busAccessor;

    // Access barring time
    static const uint32_t ELEM_BAR_I2C_ADDRESS_MAX = 127;
    uint32_t _busAccessBarMs[ELEM_BAR_I2C_ADDRESS_MAX+1];

    // Debug
    uint32_t _debugLastBusLoopMs = 0;

    // Worker task (static version calls the other)
    static void i2cWorkerTaskStatic(void* pvParameters);
    void i2cWorkerTask();

    // Helpers
    RaftI2CCentralIF::AccessResultCode i2cSendAsync(const BusI2CRequestRec* pReqRec, uint32_t pollListIdx);
    RaftI2CCentralIF::AccessResultCode i2cSendSync(const BusI2CRequestRec* pReqRec, std::vector<uint8_t>* pReadData);
    RaftI2CCentralIF::AccessResultCode checkAddrValidAndNotBarred(BusI2CAddrAndSlot addrAndSlot);
};
