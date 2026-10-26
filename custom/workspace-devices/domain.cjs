function validTokens(user, Accounts) {
  return (user?.services?.resume?.loginTokens || []).filter(token => token.hashedToken && token.when && !token.name && Accounts._tokenExpiration(token.when) > new Date());
}
function aggregateQuery(filter, since, offset, count) {
  const escaped = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    { $match: { active: { $ne: false }, ...(filter ? { username: { $regex: escaped, $options: 'i' } } : {}) } },
    { $project: { username: 1, name: 1, token: '$services.resume.loginTokens' } }, { $unwind: '$token' },
    { $match: { 'token.hashedToken': { $type: 'string' }, 'token.when': { $gt: since }, $or: [{ 'token.name': { $exists: false } }, { 'token.name': null }, { 'token.name': '' }] } },
    { $sort: { 'token.when': -1, 'token.hashedToken': 1 } },
    { $facet: { rows: [{ $skip: offset }, { $limit: count }], total: [{ $count: 'count' }] } },
  ];
}
module.exports = { validTokens, aggregateQuery };
