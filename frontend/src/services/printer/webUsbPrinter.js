export const connectPrinter = async (onStatus = () => { }) => {
    try {
        let device = null;

        onStatus('Checking previously authorized devices...');
        const authorizedDevices = await navigator.usb.getDevices();
        if (Array.isArray(authorizedDevices) && authorizedDevices.length > 0) {
            device = authorizedDevices[0];
            onStatus('Using authorized device...');
        } else {
            onStatus('Requesting device...');
            device = await navigator.usb.requestDevice({ filters: [] });
        }

        if (!device.opened) {
            onStatus('Opening device...');
            await device.open();
        }

        if (device.configuration === null) {
            onStatus('Selecting configuration...');
            await device.selectConfiguration(1);
        }

        onStatus('Searching for printer interface...');
        // FIND PRINTER INTERFACE (Class 7)
        const interfaces = device.configuration.interfaces;
        let printerInterface = null;
        let interfaceNumber = 0;

        for (const iface of interfaces) {
            const alternate = iface.alternates[0];
            if (alternate.interfaceClass === 7) {
                printerInterface = iface;
                interfaceNumber = iface.interfaceNumber;
                break;
            }
        }

        if (!printerInterface) {
            console.warn('[WebUSB] Printer class interface not detected, falling back to interface 0');
            interfaceNumber = 0;
        }

        onStatus(`Claiming interface ${interfaceNumber}...`);
        try {
            await device.claimInterface(interfaceNumber);
        } catch (claimErr) {
            console.error('[WebUSB] Claim interface failed:', claimErr);
            const claimErrorMsg = String(claimErr?.message || '').toLowerCase();
            if (claimErr?.name === 'InvalidStateError' || claimErrorMsg.includes('already claimed')) {
                onStatus(`Interface ${interfaceNumber} already claimed`);
            } else if (claimErr.name === 'SecurityError' || claimErrorMsg.includes('access denied')) {
                throw new Error('Access Denied: Another app/driver is using the printer. On Windows, you might need "WinUSB" driver (via Zadig).');
            } else {
                throw claimErr;
            }
        }

        onStatus('Ready to print');
        return device;
    } catch (error) {
        console.error('[WebUSB] Connection failed:', error);
        if (error.name === 'NotFoundError') throw new Error('No device selected');
        if (error.name === 'SecurityError') throw new Error('Permission denied by browser');
        throw error;
    }
};

export const printData = async (device, data, onStatus = () => { }) => {
    try {
        if (!device || !device.opened) {
            throw new Error('Device not connected');
        }

        onStatus('Finalizing connection...');
        // SEARCH FOR OUT ENDPOINT
        // We look for the first 'out' direction endpoint in the claimed interface
        const interfaces = device.configuration.interfaces;
        let outEndpoint = null;

        for (const iface of interfaces) {
            // Check if this interface is claimed/available
            // Note: In typical WebUSB flow, we assume the shared device object has the state
            const alternate = iface.alternates[0];
            const foundOut = alternate.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
            if (foundOut) {
                outEndpoint = foundOut;
                console.log(`[WebUSB] Found Bulk OUT endpoint: ${outEndpoint.endpointNumber} on interface ${iface.interfaceNumber}`);
                break;
            }
        }

        if (!outEndpoint) {
            // Fallback: try any 'out' endpoint
            for (const iface of interfaces) {
                const alternate = iface.alternates[0];
                const foundOut = alternate.endpoints.find(e => e.direction === 'out');
                if (foundOut) {
                    outEndpoint = foundOut;
                    break;
                }
            }
        }

        if (!outEndpoint) {
            throw new Error('No valid OUT endpoint found on this printer.');
        }

        await device.transferOut(outEndpoint.endpointNumber, data);

    } catch (error) {
        console.error('Print failed:', error);
        throw error;
    }
};
