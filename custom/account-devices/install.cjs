const fs = require('node:fs');
const file = '/app/bundle/programs/server/program.json';
const program = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!program.load.some(item => item.path === 'app/app.js')) throw new Error('Unsupported Meteor bundle');
const entry = 'account-devices.js';
if (program.load.some(item => item.path === entry)) throw new Error('Module already installed');
fs.writeFileSync('/app/bundle/programs/server/' + entry, `
Package.meteor.Meteor.startup(() => {
  Npm.require('node:module').createRequire('/app/account-devices/package.json')('./server.cjs')({
    Meteor: Package.meteor.Meteor,
    Accounts: Package['accounts-base'].Accounts,
    WebApp: Package.webapp.WebApp,
    MongoInternals: Package.mongo.MongoInternals,
  });
});
`);
program.load.push({ path: entry });
fs.writeFileSync(file, JSON.stringify(program));
