'use strict';

define('hooks', [], () => {
	const Hooks = {
		loaded: {},
		temporary: new Set(),
		runOnce: new Set(),
		deprecated: {
			'action:script.load': 'filter:script.load', // 👋 @ 1.18.0
			'action:category.loaded': 'action:topics.loaded', // 👋 @ 1.19.0
			'action:category.loading': 'action:topics.loading', // 👋 @ 1.19.0
			'action:composer.check': 'filter:composer.check', // 👋 @ 1.19.0
		},
	};

	Hooks.register = (hookName, method) => {
		Hooks.loaded[hookName] = Hooks.loaded[hookName] || new Set();
		Hooks.loaded[hookName].add(method);

		if (Hooks.deprecated.hasOwnProperty(hookName)) {
			const deprecated = Hooks.deprecated[hookName];

			if (deprecated) {
				console.groupCollapsed(`[hooks] Hook "${hookName}" is deprecated, please use "${deprecated}" instead.`);
			} else {
				console.groupCollapsed(`[hooks] Hook "${hookName}" is deprecated, there is no alternative.`);
			}

			console.info(method);
			console.groupEnd();
		}

		console.debug(`[hooks] Registered ${hookName}`, method);
	};
	Hooks.on = Hooks.register;
	Hooks.one = (hookName, method) => {
		Hooks.register(hookName, method);
		Hooks.runOnce.add({ hookName, method });
	};

	// registerPage/onPage takes care of unregistering the listener on ajaxify
	Hooks.registerPage = (hookName, method) => {
		Hooks.temporary.add({ hookName, method });
		Hooks.register(hookName, method);
	};
	Hooks.onPage = Hooks.registerPage;
	Hooks.register('action:ajaxify.start', () => {
		Hooks.temporary.forEach((pair) => {
			Hooks.unregister(pair.hookName, pair.method);
			Hooks.temporary.delete(pair);
		});
	});

	Hooks.unregister = (hookName, method) => {
		if (Hooks.loaded[hookName] && Hooks.loaded[hookName].has(method)) {
			Hooks.loaded[hookName].delete(method);
			console.debug(`[hooks] Unregistered ${hookName}`, method);
		} else {
			console.debug(`[hooks] Unregistration of ${hookName} failed, passed-in method is not a registered listener or the hook itself has no listeners, currently.`);
		}
	};
	Hooks.off = Hooks.unregister;

	Hooks.hasListeners = hookName => Hooks.loaded[hookName] && Hooks.loaded[hookName].size > 0;

	const _onHookError = (e, listener, data) => {
		console.warn(`[hooks] Exception encountered in ${listener.name ? listener.name : 'anonymous function'}, stack trace follows.`);
		console.error(e);
		return Promise.resolve(data);
	};

	const _fireFilterHook = (hookName, data) => {
		if (!Hooks.hasListeners(hookName)) {
			return Promise.resolve(data);
		}

		const listeners = Array.from(Hooks.loaded[hookName]);
		return listeners.reduce((promise, listener) => promise.then((data) => {
			try {
				const result = listener(data);
				return utils.isPromise(result) ?
					result.then(data => Promise.resolve(data)).catch(e => _onHookError(e, listener, data)) :
					result;
			} catch (e) {
				return _onHookError(e, listener, data);
			}
		}), Promise.resolve(data));
	};

	const _fireActionHook = (hookName, data) => {
		if (Hooks.hasListeners(hookName)) {
			Hooks.loaded[hookName].forEach(listener => listener(data));
		}

		// Backwards compatibility (remove this when we eventually remove jQuery from NodeBB core)
		$(window).trigger(hookName, data);
	};

	const _fireStaticHook = async (hookName, data) => {
		if (!Hooks.hasListeners(hookName)) {
			return Promise.resolve(data);
		}

		const listeners = Array.from(Hooks.loaded[hookName]);
		await Promise.allSettled(listeners.map((listener) => {
			try {
				return listener(data);
			} catch (e) {
				return _onHookError(e, listener);
			}
		}));

		return await Promise.resolve(data);
	};

	Hooks.fire = (hookName, data) => {
		const type = hookName.split(':').shift();
		let result;
		switch (type) {
			case 'filter':
				result = _fireFilterHook(hookName, data);
				break;

			case 'action':
				result = _fireActionHook(hookName, data);
				break;

			case 'static':
				result = _fireStaticHook(hookName, data);
				break;
		}
		Hooks.runOnce.forEach((pair) => {
			if (pair.hookName === hookName) {
				Hooks.unregister(hookName, pair.method);
				Hooks.runOnce.delete(pair);
			}
		});
		return result;
	};

	return Hooks;
});
