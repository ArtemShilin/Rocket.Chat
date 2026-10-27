const fs = require('node:fs');
const target = '/app/bundle/programs/server/program.json';
const program = JSON.parse(fs.readFileSync(target, 'utf8'));
if (!program.load.some(item => item.path === 'workspace-devices.js')) throw new Error('Build workspace devices first');
if (program.load.some(item => item.path === 'local-canned-responses.js')) throw new Error('Already installed');
fs.writeFileSync('/app/bundle/programs/server/local-canned-responses.js', `
Package.meteor.Meteor.startup(() => {
 const localRequire = Package.modules.meteorInstall({});
 Npm.require('node:module').createRequire('/app/canned-responses/package.json')('./server.cjs')({
  Meteor: Package.meteor.Meteor, Accounts: Package['accounts-base'].Accounts,
  WebApp: Package.webapp.WebApp, WebAppInternals: Package.webapp.WebAppInternals,
  MongoInternals: Package.mongo.MongoInternals, core: localRequire('@rocket.chat/models'),
 });
});
`);
program.load.push({ path: 'local-canned-responses.js' });
fs.writeFileSync(target + '.canned.tmp', JSON.stringify(program));
fs.chmodSync(target + '.canned.tmp', 0o444); fs.renameSync(target + '.canned.tmp', target);
