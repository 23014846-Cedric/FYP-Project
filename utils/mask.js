// utils/mask.js
function maskCard(card) {
  if (!card) return '-';
  const clean = String(card).replace(/\s+/g, '');
  const last4 = clean.slice(-4);
  return '**** **** **** ' + last4;
}

function maskAddress(address) {
  if (!address) return '-';
  // Show only rough area, hide unit details
  if (address.length <= 10) return address;
  return address.slice(0, 10) + '***';
}

module.exports = { maskCard, maskAddress };
