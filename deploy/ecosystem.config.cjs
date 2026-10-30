// PM2: exactly one instance, in fork mode. Rate limits and the document queue's
// claim-free work are held in this process's memory, so a second process would
// allow every limit twice (docs/DEPLOY-DEMO.md). The server reads its settings
// from server/.env, a link to /etc/rackium/rackium.env: no secret lives here.
const home = process.env.RACKIUM_HOME || '/opt/rackium'

module.exports = {
  apps: [
    {
      name: 'rackium-api',
      cwd: `${home}/current/server`,
      script: 'src/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '1500M',
      // The server closes its connections on SIGINT; Chromium needs a moment.
      kill_timeout: 15000,
      time: true,
      out_file: '/var/log/rackium/api.log',
      error_file: '/var/log/rackium/api-error.log',
      merge_logs: true,
    },
  ],
}
