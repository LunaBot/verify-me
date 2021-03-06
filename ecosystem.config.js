const commonDeploy = {
	user: 'xo',
	host: '165.227.220.113',
	key: '~/.ssh/deploy.key',
	ref: 'origin/main',
	repo: 'https://github.com/lunabot/verify-me',
	path: '/home/xo/code/lunabot/verify-me/production',
	'pre-deploy': 'git reset --hard',
	'post-deploy': 'pnpm install && npm run build && pm2 startOrGracefulReload ecosystem.config.js --env dev'
};

module.exports = {
	apps: [
		{
			name: 'verify-me',
			script: 'npm start',
			time: true,
			// eslint-disable-next-line
			append_env_to_name: true,
			instances: 1,
			autorestart: true,
			// eslint-disable-next-line
			max_restarts: 50,
			watch: false,
			// eslint-disable-next-line
			max_memory_restart: '250M',
			env: {
				DISPLAY: ':99',
				LOG_LEVEL: 'debug'
			},
			// eslint-disable-next-line
			env_dev: {
				LOG_LEVEL: 'debug'
			},
			// eslint-disable-next-line
			env_free: {
				LOG_LEVEL: 'info'
			},
			// eslint-disable-next-line
			env_premium: {
				LOG_LEVEL: 'info'
			}
		},
		{
			name: 'Xvfb',
			interpreter: 'none',
			script: 'Xvfb',
			args: ':99'
		}
	],
	deploy: {
		production: {
			...commonDeploy,
			path: '/home/xo/code/lunabot/verify-me/production',
			'post-deploy': 'pnpm install && npm run build && pm2 startOrGracefulReload ecosystem.config.js --env production'
		}
	}
};
