'use strict';

const SocketPlugins = {};

/*
	This file is provided exclusively so that plugins can require it and add their own socket listeners.

	How? From your plugin:

		const SocketPlugins = require.main.require('./src/socket.io/plugins');
		SocketPlugins.myPlugin = {};
		SocketPlugins.myPlugin.myMethod = function(socket, data, callback) { ... };

	Be a good lad and namespace your methods.
*/
const nconf = require('nconf');

SocketPlugins.binary = {
	getSettings: function (socket, data, callback) {
		callback(null, nconf.get('binary'));
	},
};

module.exports = SocketPlugins;
