const fs = require('node:fs');
const target = '/app/bundle/programs/server/program.json';
const program = JSON.parse(fs.readFileSync(target, 'utf8'));
if (!program.load.some(item => item.path === 'local-canned-responses.js')) throw new Error('Build canned responses first');
if (program.load.some(item => item.path === 'local-message-views.js')) throw new Error('Already installed');
fs.writeFileSync('/app/bundle/programs/server/local-message-views.js', `
Package.meteor.Meteor.startup(() => {
 const localRequire = Package.modules.meteorInstall({});
 const authorization = localRequire('/server/lib/authorization/canAccessRoom.ts');
 Npm.require('node:module').createRequire('/app/message-views/package.json')('./server.cjs')({
  Accounts: Package['accounts-base'].Accounts, WebApp: Package.webapp.WebApp,
  WebAppInternals: Package.webapp.WebAppInternals, MongoInternals: Package.mongo.MongoInternals,
  core: { ...localRequire('@rocket.chat/models'), canAccessRoomIdAsync: (...args) => authorization.canAccessRoomIdAsync(...args) },
 });
});
`);
program.load.push({ path: 'local-message-views.js' });
fs.writeFileSync(target + '.views.tmp', JSON.stringify(program));
fs.chmodSync(target + '.views.tmp', 0o444); fs.renameSync(target + '.views.tmp', target);
