const fs = require('node:fs');
const target = '/app/bundle/programs/server/program.json';
const program = JSON.parse(fs.readFileSync(target, 'utf8'));
if (!program.load.some(item => item.path === 'account-devices.js')) throw new Error('Build the account-devices base image first');
if (program.load.some(item => item.path === 'local-ai.js')) throw new Error('Local AI already installed');
fs.writeFileSync('/app/bundle/programs/server/local-ai.js', `
Package.meteor.Meteor.startup(() => {
  const localRequire = Package.modules.meteorInstall({});
  const authorization = localRequire('/server/lib/authorization/canAccessRoom.ts');
  const core = localRequire('@rocket.chat/models');
  Npm.require('node:module').createRequire('/app/local-ai/package.json')('./server.cjs')({
    Meteor: Package.meteor.Meteor,
    Accounts: Package['accounts-base'].Accounts,
    core: { ...core, canAccessRoomIdAsync: (...args) => authorization.canAccessRoomIdAsync(...args) },
    WebAppInternals: Package.webapp.WebAppInternals,
    WebApp: Package.webapp.WebApp,
    MongoInternals: Package.mongo.MongoInternals,
  });
});
`);
program.load.push({ path: 'local-ai.js' });
fs.writeFileSync(target + '.local-ai.tmp', JSON.stringify(program));
fs.chmodSync(target + '.local-ai.tmp', 0o444);
fs.renameSync(target + '.local-ai.tmp', target);
