// Downloads the mongod binary used by the in-memory replica set once, so test
// runs do not wait on the download. Safe to run repeatedly.
import { MongoMemoryServer } from 'mongodb-memory-server'

const server = await MongoMemoryServer.create()
console.log('mongod ready at', server.getUri().replace(/\/\/.*@/, '//'))
await server.stop()
