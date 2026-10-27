const fs = require('node:fs');
const target = '/app/bundle/programs/server/program.json';
const program = JSON.parse(fs.readFileSync(target, 'utf8'));
if (!program.load.some(item => item.path === 'local-canned-responses.js')) throw new Error('Build canned responses first');
if (program.load.some(item => item.path === 'native-polls.js')) throw new Error('Already installed');
fs.writeFileSync('/app/bundle/programs/server/native-polls.js', `
Package.meteor.Meteor.startup(async () => {
 const localRequire = Package.modules.meteorInstall({});
 const authorization = localRequire('/server/lib/authorization/canAccessRoom.ts');
 const messaging = await localRequire('/server/meteor-methods/messages/sendMessage.ts');
 Npm.require('node:module').createRequire('/app/native-polls/package.json')('./server.cjs')({
  Accounts: Package['accounts-base'].Accounts, WebApp: Package.webapp.WebApp,
  WebAppInternals: Package.webapp.WebAppInternals, MongoInternals: Package.mongo.MongoInternals,
  core: { ...localRequire('@rocket.chat/models'), canAccessRoomIdAsync: (...args) => authorization.canAccessRoomIdAsync(...args) },
  sendMessage: messaging.executeSendMessage,
 });
});
`);
program.load.push({ path: 'native-polls.js' });
fs.writeFileSync(target + '.polls.tmp', JSON.stringify(program));
fs.chmodSync(target + '.polls.tmp', 0o444); fs.renameSync(target + '.polls.tmp', target);
