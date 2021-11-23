'use strict';

const nconf = require('nconf');
const validator = require('validator');

const request = require('request');
const winston = require('winston');
const meta = require('../meta');
const user = require('../user');
const plugins = require('../plugins');
const privileges = require('../privileges');
const helpers = require('./helpers');
const pkg = require('../../package.json');
const slugify = require('../slugify');

const Controllers = module.exports;

Controllers.ping = require('./ping');
Controllers.home = require('./home');
Controllers.topics = require('./topics');
Controllers.posts = require('./posts');
Controllers.categories = require('./categories');
Controllers.category = require('./category');
Controllers.unread = require('./unread');
Controllers.recent = require('./recent');
Controllers.popular = require('./popular');
Controllers.top = require('./top');
Controllers.tags = require('./tags');
Controllers.search = require('./search');
Controllers.user = require('./user');
Controllers.users = require('./users');
Controllers.groups = require('./groups');
Controllers.accounts = require('./accounts');
Controllers.authentication = require('./authentication');
Controllers.api = require('./api');
Controllers.admin = require('./admin');
Controllers.globalMods = require('./globalmods');
Controllers.mods = require('./mods');
Controllers.sitemap = require('./sitemap');
Controllers.osd = require('./osd');
Controllers['404'] = require('./404');
Controllers.errors = require('./errors');
Controllers.composer = require('./composer');

Controllers.write = require('./write');

Controllers.reset = async function (req, res) {
	if (meta.config['password:disableEdit']) {
		return helpers.notAllowed(req, res);
	}

	res.locals.metaTags = {
		...res.locals.metaTags,
		name: 'robots',
		content: 'noindex',
	};

	const renderReset = function (code, valid) {
		res.render('reset_code', {
			valid: valid,
			displayExpiryNotice: req.session.passwordExpired,
			code: code,
			minimumPasswordLength: meta.config.minimumPasswordLength,
			minimumPasswordStrength: meta.config.minimumPasswordStrength,
			breadcrumbs: helpers.buildBreadcrumbs([
				{
					text: '[[reset_password:reset_password]]',
					url: '/reset',
				},
				{
					text: '[[reset_password:update_password]]',
				},
			]),
			title: '[[pages:reset]]',
		});
		delete req.session.passwordExpired;
	};

	if (req.params.code) {
		req.session.reset_code = req.params.code;
	}

	if (req.session.reset_code) {
		// Validate and save to local variable before removing from session
		const valid = await user.reset.validate(req.session.reset_code);
		renderReset(req.session.reset_code, valid);
		delete req.session.reset_code;
	} else {
		res.render('reset', {
			code: null,
			breadcrumbs: helpers.buildBreadcrumbs([{
				text: '[[reset_password:reset_password]]',
			}]),
			title: '[[pages:reset]]',
		});
	}
};

Controllers.login = async function (req, res) {
	if (req.query.token) {
		const jwt = req.query.token;
		const GET_USER_DATA = {
			operationName: null,
			variables: {},
			// language=GraphQL
			query: 'query{\n    myData{\n        id\n        username\n        email\n        page\n        avatarUrl\n        role { name type }\n    }\n}',
		};
		const { resServer, body } = await new Promise((resolve, reject) => {
			request({
				method: 'POST',
				url: nconf.get('binary').graphql_api,
				body: GET_USER_DATA,
				json: true,
				headers: {
					Authorization: `Bearer ${jwt}`,
				},
			}, (err, res, body) => (err ? reject(err) : resolve({ resServer: res, body })));
		});
		if (resServer.statusCode !== 200) {
			// toDo 21.11.21, guille, redirect to login without token
		} else {
			const data = body.data.myData;
			const userData = {
				username: data.username,
				userslug: slugify(data.username),
				email: data.email || '',
			};
			const exists = await meta.userOrGroupExists(userData.username);
			let uid;
			let nextRedirection = req.session.returnTo || `${nconf.get('relative_path')}/`;

			if (!exists) {
				uid = await user.create(userData);
				await plugins.hooks.fire('filter:register.complete', { uid: uid, next: nextRedirection });
			} else {
				const query = await user.search({ query: userData.username });
				uid = query.users[0].uid;
			}

			await Controllers.authentication.doLogin(req, uid);

			if (req.session.returnTo) {
				nextRedirection = nextRedirection.startsWith('http') ?
					nextRedirection :
					nconf.get('relative_path') + nextRedirection;
				delete req.session.returnTo;
			} else {
				nextRedirection = `${nconf.get('relative_path')}/`;
			}
			return res.redirect(nextRedirection);
		}
	}

	const data = { loginFormEntry: [] };
	const loginStrategies = require('../routes/authentication').getLoginStrategies();
	const registrationType = meta.config.registrationType || 'normal';
	const allowLoginWith = (meta.config.allowLoginWith || 'username-email');

	let errorText;
	if (req.query.error === 'csrf-invalid') {
		errorText = '[[error:csrf-invalid]]';
	} else if (req.query.error) {
		errorText = validator.escape(String(req.query.error));
	}

	if (req.headers['x-return-to']) {
		req.session.returnTo = req.headers['x-return-to'];
	}

	// Occasionally, x-return-to is passed a full url.
	req.session.returnTo = req.session.returnTo && req.session.returnTo.replace(nconf.get('base_url'), '').replace(nconf.get('relative_path'), '');

	data.alternate_logins = loginStrategies.length > 0;
	data.authentication = loginStrategies;
	data.allowRegistration = registrationType === 'normal';
	data.allowLoginWith = `[[login:${allowLoginWith}]]`;
	data.breadcrumbs = helpers.buildBreadcrumbs([{
		text: '[[global:login]]',
	}]);
	data.error = req.flash('error')[0] || errorText;
	data.title = '[[pages:login]]';
	data.allowPasswordReset = !meta.config['password:disableEdit'];

	const hasLoginPrivilege = await privileges.global.canGroup('local:login', 'registered-users');
	data.allowLocalLogin = hasLoginPrivilege || parseInt(req.query.local, 10) === 1;

	if (!data.allowLocalLogin && !data.allowRegistration && data.alternate_logins && data.authentication.length === 1) {
		return helpers.redirect(res, { external: data.authentication[0].url });
	}

	if (req.loggedIn) {
		const userData = await user.getUserFields(req.uid, ['username', 'email']);
		data.username = allowLoginWith === 'email' ? userData.email : userData.username;
		data.alternate_logins = false;
	}
	res.render('login', data);
};

Controllers.register = async function (req, res, next) {
	const registrationType = meta.config.registrationType || 'normal';

	if (registrationType === 'disabled') {
		return setImmediate(next);
	}

	let errorText;
	const returnTo = (req.headers['x-return-to'] || '').replace(nconf.get('base_url') + nconf.get('relative_path'), '');
	if (req.query.error === 'csrf-invalid') {
		errorText = '[[error:csrf-invalid]]';
	}
	try {
		if (registrationType === 'invite-only' || registrationType === 'admin-invite-only') {
			try {
				await user.verifyInvitation(req.query);
			} catch (e) {
				return res.render('400', {
					error: e.message,
				});
			}
		}

		if (returnTo) {
			req.session.returnTo = returnTo;
		}

		const loginStrategies = require('../routes/authentication').getLoginStrategies();
		res.render('register', {
			'register_window:spansize': loginStrategies.length ? 'col-md-6' : 'col-md-12',
			alternate_logins: !!loginStrategies.length,
			authentication: loginStrategies,

			minimumUsernameLength: meta.config.minimumUsernameLength,
			maximumUsernameLength: meta.config.maximumUsernameLength,
			minimumPasswordLength: meta.config.minimumPasswordLength,
			minimumPasswordStrength: meta.config.minimumPasswordStrength,
			breadcrumbs: helpers.buildBreadcrumbs([{
				text: '[[register:register]]',
			}]),
			regFormEntry: [],
			error: req.flash('error')[0] || errorText,
			title: '[[pages:register]]',
		});
	} catch (err) {
		next(err);
	}
};

Controllers.registerInterstitial = async function (req, res, next) {
	if (!req.session.hasOwnProperty('registration')) {
		return res.redirect(`${nconf.get('relative_path')}/register`);
	}
	try {
		const data = await plugins.hooks.fire('filter:register.interstitial', {
			req,
			userData: req.session.registration,
			interstitials: [],
		});

		if (!data.interstitials.length) {
			// No interstitials, redirect to home
			const returnTo = req.session.returnTo || req.session.registration.returnTo;
			delete req.session.registration;
			return helpers.redirect(res, returnTo || '/');
		}

		const errors = req.flash('errors');
		const renders = data.interstitials.map(
			interstitial => req.app.renderAsync(interstitial.template, { ...interstitial.data || {}, errors })
		);
		const sections = await Promise.all(renders);

		res.render('registerComplete', {
			title: '[[pages:registration-complete]]',
			register: data.userData.register,
			sections,
			errors,
		});
	} catch (err) {
		next(err);
	}
};

Controllers.confirmEmail = async (req, res, next) => {
	try {
		await user.email.confirmByCode(req.params.code, req.session.id);
	} catch (e) {
		if (e.message === '[[error:invalid-data]]') {
			return next();
		}

		throw e;
	}

	res.render('confirm', {
		title: '[[pages:confirm]]',
	});
};

Controllers.robots = function (req, res) {
	res.set('Content-Type', 'text/plain');

	if (meta.config['robots:txt']) {
		res.send(meta.config['robots:txt']);
	} else {
		res.send(`${'User-agent: *\n' +
			'Disallow: '}${nconf.get('relative_path')}/admin/\n` +
			`Disallow: ${nconf.get('relative_path')}/reset/\n` +
			`Disallow: ${nconf.get('relative_path')}/compose\n` +
			`Sitemap: ${nconf.get('url')}/sitemap.xml`);
	}
};

Controllers.manifest = async function (req, res) {
	const manifest = {
		name: meta.config.title || 'NodeBB',
		short_name: meta.config['title:short'] || meta.config.title || 'NodeBB',
		start_url: nconf.get('url'),
		display: 'standalone',
		orientation: 'portrait',
		theme_color: meta.config.themeColor || '#ffffff',
		background_color: meta.config.backgroundColor || '#ffffff',
		icons: [],
	};

	if (meta.config['brand:touchIcon']) {
		manifest.icons.push({
			src: `${nconf.get('relative_path')}/assets/uploads/system/touchicon-36.png`,
			sizes: '36x36',
			type: 'image/png',
			density: 0.75,
		}, {
			src: `${nconf.get('relative_path')}/assets/uploads/system/touchicon-48.png`,
			sizes: '48x48',
			type: 'image/png',
			density: 1.0,
		}, {
			src: `${nconf.get('relative_path')}/assets/uploads/system/touchicon-72.png`,
			sizes: '72x72',
			type: 'image/png',
			density: 1.5,
		}, {
			src: `${nconf.get('relative_path')}/assets/uploads/system/touchicon-96.png`,
			sizes: '96x96',
			type: 'image/png',
			density: 2.0,
		}, {
			src: `${nconf.get('relative_path')}/assets/uploads/system/touchicon-144.png`,
			sizes: '144x144',
			type: 'image/png',
			density: 3.0,
		}, {
			src: `${nconf.get('relative_path')}/assets/uploads/system/touchicon-192.png`,
			sizes: '192x192',
			type: 'image/png',
			density: 4.0,
		}, {
			src: `${nconf.get('relative_path')}/assets/uploads/system/touchicon-512.png`,
			sizes: '512x512',
			type: 'image/png',
			density: 10.0,
		});
	}


	if (meta.config['brand:maskableIcon']) {
		manifest.icons.push({
			src: `${nconf.get('relative_path')}/assets/uploads/system/maskableicon-orig.png`,
			type: 'image/png',
			purpose: 'maskable',
		});
	} else if (meta.config['brand:touchIcon']) {
		manifest.icons.push({
			src: `${nconf.get('relative_path')}/assets/uploads/system/touchicon-orig.png`,
			type: 'image/png',
			purpose: 'maskable',
		});
	}

	const data = await plugins.hooks.fire('filter:manifest.build', {
		req: req,
		res: res,
		manifest: manifest,
	});
	res.status(200).json(data.manifest);
};

Controllers.outgoing = function (req, res, next) {
	const url = req.query.url || '';
	const allowedProtocols = [
		'http', 'https', 'ftp', 'ftps', 'mailto', 'news', 'irc', 'gopher',
		'nntp', 'feed', 'telnet', 'mms', 'rtsp', 'svn', 'tel', 'fax', 'xmpp', 'webcal',
	];
	const parsed = require('url').parse(url);

	if (!url || !parsed.protocol || !allowedProtocols.includes(parsed.protocol.slice(0, -1))) {
		return next();
	}

	res.render('outgoing', {
		outgoing: validator.escape(String(url)),
		title: meta.config.title,
		breadcrumbs: helpers.buildBreadcrumbs([{
			text: '[[notifications:outgoing_link]]',
		}]),
	});
};

Controllers.termsOfUse = async function (req, res, next) {
	if (!meta.config.termsOfUse) {
		return next();
	}
	const termsOfUse = await plugins.hooks.fire('filter:parse.post', {
		postData: {
			content: meta.config.termsOfUse || '',
		},
	});
	res.render('tos', {
		termsOfUse: termsOfUse.postData.content,
	});
};
