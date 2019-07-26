// SpeechBubble API Layer
// Copyright (c) 2017 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var assert = require("assert");
var async = require('async');

var Class = require("pixl-class");
var Tools = require("pixl-tools");
var PixlRequest = require("pixl-request");

module.exports = Class.create({
	
	__mixins: [
		require('./api/config.js'),
		require('./api/channel.js'),
		require('./api/admin.js'),
		require('./api/apikey.js'),
		require('./api/avatar.js'),
		require('./api/file.js'),
		require('./api/search.js'),
		require('./api/emoji.js')
	],
	
	api_ping: function(args, callback) {
		// hello
		callback({ code: 0 });
	},
	
	api_echo: function(args, callback) {
		// for testing: adds 1 second delay, echoes everything back
		setTimeout( function() {
			callback({
				code: 0,
				query: args.query || {},
				params: args.params || {},
				files: args.files || {}
			});
		}, 1000 );
	},
	
	api_check_user_exists: function(args, callback) {
		// checks if username is taken (used for showing green checkmark on form)
		var self = this;
		var query = args.query;
		var path = 'users/' + this.usermgr.normalizeUsername(query.username);
		
		if (!this.requireParams(query, {
			username: this.usermgr.usernameMatch
		}, callback)) return;
		
		// do not cache this API response
		this.forceNoCacheResponse(args);
		
		this.storage.get(path, function(err, user) {
			callback({ code: 0, user_exists: !!user });
		} );
	},
	
	api_get_home_info: function(args, callback) {
		// get user and server info, for home page
		var self = this;
		var mem = process.memoryUsage();
		
		var num_users_online = 0;
		for (var username in this.users) {
			if (this.users[username].ip) num_users_online++;
		}
		
		var status = {
			hostname: this.server.hostname,
			now: Tools.timeNow(),
			server_started: this.server.started,
			users_online: num_users_online,
			total_mem_bytes: mem.rss,
			total_cpu_pct: this.cpu.current.pct,
			os_version: this.os_version,
			total_messages_sent: this.stats.messages_sent || 0,
			total_bytes_in: this.stats.bytes_in || 0,
			total_bytes_out: this.stats.bytes_out || 0,
			total_users: 0,
			total_channels: 0,
			user_online: false
		};
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var username = user.username;
			user = self.users[username];
			
			if (user && user.ip) {
				status.user_online = true;
				status.user_login_time = user.login_time;
				status.user_ip = user.ip;
				status.user_cmd_time = user.last_cmd_time;
				status.user_last_cmd = user.last_cmd;
			}
			
			// self.users has ALL users, logged in or no
			status.total_users = Tools.numKeys( self.users );
			status.total_channels = Tools.numKeys( self.channels );
			
			callback({ code: 0, status: status });
			
		} ); // session
	},
	
	api_user_update: function(args, callback) {
		// allow update of non-essential data in user record without supplying a fresh password
		// used for updating things like 'emoji_skin_tone', 'status' and 'nickname'
		var self = this;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			// update user
			user.modified = Tools.timeNow(true);
			
			args.user = user;
			args.session = session;
			
			// clean up nickname
			self.beforeUserChange( args, function(err) {
				if (err) {
					return self.doError('user', "Failed to update user: " + err, callback);
				}
				
				var updates = Tools.copyHashRemoveKeys(args.params, {
					username: 1,
					password: 1,
					salt: 1,
					full_name: 1,
					email: 1
				});
				for (var key in updates) user[key] = updates[key];
				
				self.logDebug(6, "Updating user", updates);
				
				self.storage.put( "users/" + self.normalizeUsername(user.username), user, function(err, data) {
					if (err) {
						return self.doError('user', "Failed to update user: " + err, callback);
					}
					
					self.logDebug(6, "Successfully updated user");
					self.logTransaction('user_update', user.username, 
						self.getClientInfo(args, { user: Tools.copyHashRemoveKeys( user, { password: 1, salt: 1 } ) }));
					
					callback({ code: 0 });
					
					// broadcast change to all channels
					self.afterUserChange( 'user_update', { session: session, user: user } );
				} ); // storage.put
			} ); // beforeUserChange
		} ); // loaded session
	},
	
	api_user_info: function(args, callback) {
		// get information on any user
		// for admins, get even more info (ips, etc.)
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			username: this.usermgr.usernameMatch
		}, callback)) return;
		
		this.loadSession(args, function(err, session, self_user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, self_user, callback)) return;
			
			var user = self.users[params.username];
			if (!user) {
				return self.doError('user', "User not found: " + params.username, callback);
			}
			
			var resp = {
				code: 0,
				user: Tools.copyHashRemoveKeys( user, { sockets: 1, password: 1, salt: 1, email: 1, live_channels: 1 } ),
				is_online: !!(user.sockets && Tools.numKeys(user.sockets))
			};
			
			// find initial connect time
			if (user.login_time) {
				resp.online_time = Math.floor( Tools.timeNow() - user.login_time );
			}
			else if (user.logout_time) {
				resp.offline_time = Math.floor( Tools.timeNow() - user.logout_time );
			}
			
			// list rooms (+perm check!)
			if (resp.is_online && user.live_channels) {
				var chans = [];
				
				for (var chan in user.live_channels) {
					var channel = self.channels[chan];
					if (self_user.privileges.admin || !channel.private || channel.users[session.username]) {
						chans.push( chan );
					}
				}
				
				resp.channels = chans;
			} // is_online
			
			// admin only
			if (self_user.privileges.admin) {
				resp.user.email = user.email;
				
				if (resp.is_online) {
					var socks = [];
					
					for (var key in user.sockets) {
						var socket = user.sockets[key];
						socks.push({
							ip: socket.ip,
							ping: socket.metadata.ping_ms || 0
						});
					}
					
					resp.sockets = socks;
				} // is_online
			} // admin
			
			callback(resp);
		} ); // session
	},
	
	api_oembed: function(args, callback) {
		// invoke oEmbed API and send IFRAME response
		var self = this;
		this.logDebug(9, "oEmbed API Start: ", args.query);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			self.logDebug(9, "Session and user validated");
			
			var provider_url = args.query.provider_url;
			var eargs = Tools.copyHashRemoveKeys( args.query, { provider_url: 1, session_id: 1 } );
			var request = new PixlRequest( 'SpeechBubble Chat ' + self.server.__version );
			request.setFollow( 32 );
			
			self.logDebug(9, "Calling oEmbed API: " + provider_url);
			
			request.json( provider_url, null, function(err, resp, data) {
				if (!err && !data.html) {
					err = new Error("oEmbed did not provide HTML presentation.");
				}
				if (err) {
					// return callback({ code: 1, description: "oEmbed API Error: " + err });
					self.logError('oembed', "oEmbed API Error: " + err);
					data = { html: '<script>window.close();</script>' };
				}
				
				// hack for youtube fullscreen
				if (provider_url.match(/youtube/)) {
					data.html = data.html
						.replace(/allowfullscreen\=\"[^\"]*\"/, '')
						.replace(/allowfullscreen/, '')
						.replace(/\bsrc\=\"([^\"]+)\"/, 'src="$1&fs=0"');
				}
				
				// hack for instagram width (sigh)
				eargs.contwidth = 'auto';
				if (provider_url.match(/instagram/)) {
					eargs.contwidth = '' + eargs.maxwidth + 'px';
				}
				
				self.logDebug(9, "oEmbed Response:", data);
				
				eargs.oembed = data.html;
				var html = Tools.substitute( self.oembed_template, eargs );
				self.logDebug(9, "HTML Response: " + html);
				
				return callback(
					"200 OK",
					{ 'Content-Type': "text/html" },
					html
				);
				
			} ); // request.json
		} ); // loaded session
	},
	
	forceNoCacheResponse: function(args) {
		// make sure this response isn't cached, ever
		args.response.setHeader( 'Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate' );
		args.response.setHeader( 'Expires', 'Thu, 01 Jan 1970 00:00:00 GMT' );
	},
	
	getServerBaseAPIURL: function(hostname) {
		// construct fully-qualified URL to API on specified hostname
		// use proper protocol and ports as needed
		var api_url = '';
		
		if (this.web.config.get('https') && this.web.config.get('https_force')) {
			api_url = 'https://' + hostname;
			if (this.web.config.get('https_port') != 443) api_url += ':' + this.web.config.get('https_port');
		}
		else {
			api_url = 'http://' + hostname;
			if (this.web.config.get('http_port') != 80) api_url += ':' + this.web.config.get('http_port');
		}
		api_url += this.api.config.get('base_uri');
		
		return api_url;
	},
	
	requireValidUser: function(session, user, callback) {
		// make sure user and session are valid
		// otherwise throw an API error and return false
		
		if (session && (session.type == 'api')) {
			// session is simulated, created by API key
			if (!user) {
				return this.doError('api', "Invalid API Key: " + session.api_key, callback);
			}
			if (!user.active) {
				return this.doError('api', "API Key is disabled: " + session.api_key, callback);
			}
			return true;
		} // api key
		
		if (!session) {
			return this.doError('session', "Session has expired or is invalid.", callback);
		}
		if (!user) {
			return this.doError('user', "User not found: " + session.username, callback);
		}
		if (!user.active) {
			return this.doError('user', "User account is disabled: " + session.username, callback);
		}
		return true;
	},
	
	requireAdmin: function(session, user, callback) {
		// make sure user and session are valid, and user is an admin
		// otherwise throw an API error and return false
		if (!this.requireValidUser(session, user, callback)) return false;
		
		if (session.type == 'api') {
			// API Keys cannot be admins
			return this.doError('api', "API Key cannot use administrator features", callback);
		}
		
		if (!user.privileges.admin) {
			return this.doError('user', "User is not an administrator: " + session.username, callback);
		}
		
		return true;
	},
	
	requirePrivilege: function(user, priv_id, callback) {
		// make sure user has the specified privilege
		// otherwise throw an API error and return false
		if (user.privileges.admin) return true; // admins can do everything
		if (user.privileges[priv_id]) return true;
		
		if (user.key) {
			return this.doError('api', "API Key ('"+user.title+"') does not have the required privileges to perform this action ("+priv_id+").", callback);
		}
		else {
			return this.doError('user', "User '"+user.username+"' does not have the required account privileges to perform this action ("+priv_id+").", callback);
		}
	},
	
	getClientInfo: function(args, params) {
		// proxy over to user module
		// var info = this.usermgr.getClientInfo(args, params);
		var info = null;
		if (params) info = Tools.copyHash(params, true);
		else info = {};
		
		info.ip = args.ip;
		info.headers = args.request.headers;
		
		// augment with our own additions
		if (args.admin_user) info.username = args.admin_user.username;
		else if (args.user) {
			if (args.user.key) {
				// API Key
				info.api_key = args.user.key;
				info.api_title = args.user.title;
			}
			else {
				info.username = args.user.username;
			}
		}
		
		return info;
	},
	
	loadUser: function(username, callback) {
		// load user record from storage
		this.storage.get('users/' + this.usermgr.normalizeUsername(username), callback );
	},
	
	loadSession: function(args, callback) {
		// Load user session or validate API Key
		var self = this;
		var session_id = args.cookies['session_id'] || args.request.headers['x-session-id'] || args.params.session_id || args.query.session_id;
		
		if (session_id) {
			this.logDebug(9, "Found Session ID: " + session_id);
			
			this.storage.get('sessions/' + session_id, function(err, session) {
				if (err) return callback(err, null, null);
				
				// also load user
				self.storage.get('users/' + self.usermgr.normalizeUsername(session.username), function(err, user) {
					if (err) return callback(err, null, null);
					
					// set type to discern this from API Key sessions
					session.type = 'user';
					
					// get session_id out of args.params, so it doesn't interfere with API calls
					delete args.params.session_id;
					
					// pass both session and user to callback
					callback(null, session, user);
				} );
			} );
			return;
		}
		
		// no session found, look for API Key
		var api_key = args.request.headers['x-api-key'] || args.params.api_key || args.query.api_key;
		if (!api_key) return callback( new Error("No Session ID or API Key could be found"), null, null );
		
		this.logDebug(9, "Found API Key: " + api_key);
		
		// API keys are indexed in memory by their 'id' (not their 'key')
		// so we have to do a loop to find the right one
		var api_app = null;
		for (var id in this.api_keys) {
			if (this.api_keys[id].key == api_key) {
				api_app = this.api_keys[id];
				break;
			}
		}
		
		if (api_app) {
			// create simulated session and user objects
			var session = {
				type: 'api',
				api_key: api_key
			};
			var user = api_app;
			
			// get api_key out of args.params, so it doesn't interfere with API calls
			delete args.params.api_key;
			
			// pass both "session" and "user" to callback
			callback(null, session, user);
		}
		else {
			return callback(new Error("API Key is invalid: " + api_key), null, null);
		}
	},
	
	requireParams: function(params, rules, callback) {
		// proxy over to user module
		assert( arguments.length == 3, "Wrong number of arguments to requireParams" );
		return this.usermgr.requireParams(params, rules, callback);
	},
	
	doError: function(code, msg, callback) {
		// proxy over to user module
		assert( arguments.length == 3, "Wrong number of arguments to doError" );
		return this.usermgr.doError( code, msg, callback );
	}
	
});
