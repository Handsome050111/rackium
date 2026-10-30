// Run by setup-ubuntu.sh with mongosh; passwords come from the environment. Safe
// to run again: once the admin user exists it simply signs in. Before that,
// MongoDB's localhost exception allows starting the replica set and creating
// the first user.
const env = process.env
const admin = db.getSiblingDB('admin')

function signIn() {
  try {
    return admin.auth('rackium_admin', env.MONGO_ADMIN_PASSWORD).ok === 1
  } catch {
    return false
  }
}

if (!signIn()) {
  try {
    rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })
  } catch (err) {
    if (!/already initialized/i.test(err.message)) throw err
  }
  for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i++) sleep(1000)
  if (!db.hello().isWritablePrimary) throw new Error('The replica set has no primary after a minute')
  admin.createUser({ user: 'rackium_admin', pwd: env.MONGO_ADMIN_PASSWORD, roles: ['root'] })
  if (!signIn()) throw new Error('Cannot sign in as the new admin user')
}

if (!admin.getUser('rackium_backup')) admin.createUser({ user: 'rackium_backup', pwd: env.MONGO_BACKUP_PASSWORD, roles: ['backup', 'clusterMonitor'] })
const app = db.getSiblingDB('rackium')
if (!app.getUser('rackium')) app.createUser({ user: 'rackium', pwd: env.MONGO_APP_PASSWORD, roles: [{ role: 'readWrite', db: 'rackium' }] })
print('MongoDB: replica set rs0 and its users are ready.')
