const { getOwnerDashboardData } = require('./src/services/ownerDashboardData.service');

async function run() {
    try {
        const mockReq = {
            headers: { authorization: 'Bearer MOCK' },
            query: { filter: 'Today' },
            id: 'mock-req-123'
        };

        // Override verifyIdToken to bypass auth locally
        const accessControl = require('./src/services/accessControl.service');
        // Using a known ownerId from the system, like Ashwani's UID
        // We will just patch `getRequesterContext`
        const originalGetRequesterContext = accessControl.__get__ ? accessControl.__get__('getRequesterContext') : null;

        if (!originalGetRequesterContext) {
            console.log('Cannot mock getRequesterContext easily without rewire, will just run proxy.');
        }
    } catch (error) {
        console.error("Test Error:", error);
    }
}
run();
