const AuditAnchor = artifacts.require("AuditAnchor");

module.exports = function (deployer) {
  deployer.deploy(AuditAnchor);
};
