function generateCustomerOrderId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const randomPart = String(Math.floor(1000 + Math.random() * 9000));
  return `${yy}${mm}${dd}${randomPart}`;
}

module.exports = { generateCustomerOrderId };
