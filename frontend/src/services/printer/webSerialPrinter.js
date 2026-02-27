export const connectSerialPrinter = async (onStatus = () => { }) => {
    if (!('serial' in navigator)) {
        throw new Error('WebSerial is not supported in this browser.');
    }

    let port = null;
    try {
        onStatus('Checking previously authorized serial ports...');
        const authorizedPorts = await navigator.serial.getPorts();
        if (Array.isArray(authorizedPorts) && authorizedPorts.length > 0) {
            port = authorizedPorts[0];
            onStatus('Using authorized serial port...');
        } else {
            onStatus('Requesting serial port...');
            port = await navigator.serial.requestPort();
        }

        if (!port.readable && !port.writable) {
            onStatus('Opening serial port...');
            await port.open({
                baudRate: 9600,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none',
            });
        }

        onStatus('Serial printer ready');
        return port;
    } catch (error) {
        console.error('[WebSerial] Connection failed:', error);
        if (error?.name === 'NotFoundError') {
            throw new Error('No serial port selected');
        }
        throw error;
    }
};

export const printSerialData = async (port, data, onStatus = () => { }) => {
    if (!port || !port.writable) {
        throw new Error('Serial device not connected');
    }

    let writer = null;
    try {
        onStatus('Sending data to serial printer...');
        writer = port.writable.getWriter();
        await writer.write(data);
    } catch (error) {
        console.error('[WebSerial] Print failed:', error);
        throw error;
    } finally {
        if (writer) writer.releaseLock();
    }
};
