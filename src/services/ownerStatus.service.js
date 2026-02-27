const { resolveOwnerContext } = require('./accessControl.service');

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function getOwnerStatus(req) {
  const owner = await resolveOwnerContext(req, {
    allowEmployee: true,
    allowAdminImpersonation: true,
  });

  const businessData = owner.businessData || {};

  return {
    status: String(businessData.approvalStatus || 'pending').trim() || 'pending',
    restrictedFeatures: toArray(businessData.restrictedFeatures),
    suspensionRemark: String(businessData.suspensionRemark || ''),
  };
}

module.exports = {
  getOwnerStatus,
};
