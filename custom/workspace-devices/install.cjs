const fs = require('node:fs');
const target = '/app/bundle/programs/server/program.json';
const program = JSON.parse(fs.readFileSync(target, 'utf8'));
if (!program.load.some(item => item.path === 'local-ai.js')) throw new Error('Build the local AI base image first');
if (program.load.some(item => item.path === 'workspace-devices.js')) throw new Error('Workspace devices already installed');
fs.writeFileSync('/app/bundle/programs/server/workspace-devices.js', `
Package.meteor.Meteor.startup(async () => {
 const localRequire = Package.modules.meteorInstall({});
 Npm.require('node:module').createRequire('/app/workspace-devices/package.json')('./server.cjs')({
  Meteor: Package.meteor.Meteor,
  Accounts: Package['accounts-base'].Accounts,
  WebApp: Package.webapp.WebApp,
  MongoInternals: Package.mongo.MongoInternals,
  core: localRequire('@rocket.chat/models'),
  coreServices: await localRequire('@rocket.chat/core-services'),
  twoFactor: await localRequire('/server/lib/2fa/code/index.ts'),
 });
});
`);
program.load.push({ path: 'workspace-devices.js' });
fs.writeFileSync(target + '.workspace.tmp', JSON.stringify(program));
fs.chmodSync(target + '.workspace.tmp', 0o444); fs.renameSync(target + '.workspace.tmp', target);
