const { getAuth } = require('../lib/firebaseAdmin');
const { resolveAdminContext } = require('./adminAccess.service');

async function getTestPing() {
  return {
    message: `Hello World! New deployment trigger at ${new Date().toISOString()}`,
  };
}

async function getTestAdmin(req) {
  await resolveAdminContext(req, { checkRevoked: false });
  const auth = await getAuth();
  await auth.getUserByEmail('test@example.com').catch((error) => {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  });

  return {
    message: 'Firebase Admin SDK Initialized and Authenticated Successfully!',
    details: 'The server-side Firebase environment is configured correctly and can communicate with the correct Firebase project.',
  };
}

module.exports = {
  getTestPing,
  getTestAdmin,
};
