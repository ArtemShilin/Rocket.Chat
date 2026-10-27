const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const local = path.resolve(__dirname, '../../../deploy/local');
const state = path.join(local, '.state/native-polls-test-ids.json');
const records = JSON.parse(fs.readFileSync(state));
if (!Array.isArray(records) || !records.every(row => ['id','roomId','creatorId'].every(key => typeof row[key] === 'string' && /^[\w-]{1,200}$/.test(row[key])))) throw new Error('Invalid test cleanup manifest');
if (records.length) {
  const clauses = records.map(({id,roomId,creatorId}) => ({ _id:id,roomId,creatorId }));
  const script = `const d=db.getSiblingDB('rocketchat');const ids=d.rocketchat_native_polls.find({$or:${JSON.stringify(clauses)}},{_id:1}).toArray().map(p=>p._id);printjson({ballots:d.rocketchat_native_poll_ballots.deleteMany({pollId:{$in:ids}}).deletedCount,polls:d.rocketchat_native_polls.deleteMany({_id:{$in:ids}}).deletedCount});`;
  process.stdout.write(execFileSync(path.join(local,'manage.sh'),['compose','exec','-T','mongodb','mongosh','--quiet','--eval',script],{encoding:'utf8'}));
  fs.writeFileSync(state,'[]\n',{mode:0o600});
}
