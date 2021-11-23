'use strict';

const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json'));
config.binary = {
	login_page: process.env.BINARY_LOGIN_PAGE,
	graphql_api: process.env.BINARY_GRAPHQL_API,
};
fs.writeFileSync('config.json', JSON.stringify(config, null, '  '), { encoding: 'utf8' });
