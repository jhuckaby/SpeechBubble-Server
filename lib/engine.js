// SpeechBubble Server Component
// Copyright (c) 2017 Joseph Huckaby
// Released under the MIT License

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var Path = require('path');
var mkdirp = require('mkdirp');
var async = require('async');
var glob = require('glob');
var getos = require('getos');
var sanitizeHtml = require('sanitize-html');

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var Tools = require("pixl-tools");
var Request = require("pixl-request");

module.exports = Class.create({
	
	__name: 'SpeechBubble',
	__parent: Component,
	__mixins: [ 
		require('./api.js'),    // API Layer Mixin
		require('./comm.js'),   // Communication Layer Mixin
		require('./command.js') // Command Layer Mixin
	],
	
	users: null,
	channels: null,
	stats: null,
	dirCache: null,
	webHookCache: null,
	
	startup: function(callback) {
		// start app api service
		var self = this;
		this.logDebug(3, "SpeechBubble engine starting up", process.argv );
		
		// we'll need these components frequently
		this.storage = this.server.Storage;
		this.unbase = this.server.Unbase;
		this.web = this.server.WebServer;
		this.api = this.server.API;
		this.usermgr = this.server.User;
		
		// register our class as an API namespace
		this.api.addNamespace( "app", "api_", this );
		
		// shortcut for /api/app/file
		this.web.addURIHandler( /^\/files/, "File", this.api_file.bind(this) );
		
		// register a handler for HTTP OPTIONS (for CORS AJAX preflight)
		this.web.addMethodHandler( "OPTIONS", "CORS Preflight", this.corsPreflight.bind(this) );
		
		// SpeechBot proxy for /bot URI prefix
		if (this.server.config.get('bot_proxy')) {
			// TODO HACK ALERT: Had to add specific /bot/txt because /bot is used by mobile app!  GAH!!!!!
			this.web.addURIHandler( /^\/bot\/txt/, "Bot", this.botProxy.bind(this) );
		}
		
		// listen for ticks so we can broadcast status
		this.server.on('tick', this.tick.bind(this));
		
		// register hooks for when users are created / updated / deleted
		this.usermgr.registerHook( 'after_create', this.afterUserChange.bind(this, 'user_create') );
		this.usermgr.registerHook( 'after_update', this.afterUserChange.bind(this, 'user_update') );
		this.usermgr.registerHook( 'after_delete', this.afterUserChange.bind(this, 'user_delete') );
		this.usermgr.registerHook( 'after_login', this.afterUserLogin.bind(this) );
		
		this.usermgr.registerHook( 'before_create', this.beforeUserChange.bind(this) );
		this.usermgr.registerHook( 'before_update', this.beforeUserChange.bind(this) );
		
		// intercept user login and session resume, to merge in extra data
		this.usermgr.registerHook( 'before_login', this.beforeUserLogin.bind(this) );
		this.usermgr.registerHook( 'before_resume_session', this.beforeUserLogin.bind(this) );
		
		// archive logs daily at midnight
		this.server.on('day', function() {
			self.archiveLogs();
		} );
		
		// only the master server should enable storage maintenance
		this.server.on(this.server.config.get('maintenance'), function() {
			self.storage.runMaintenance( new Date(), self.runMaintenance.bind(self) );
		});
		
		// clear daemon stats every day at midnight
		this.stats = {};
		this.server.on('day', function() {
			self.stats = {};
		} );
		
		// cpu usage for this process, updates every tick
		this.cpu = {
			current: { user: 0, system: 0, pct: 0 }
		};
		
		// preload oembed iframe template
		this.oembed_template = fs.readFileSync( 'htdocs/oembed-template.html', 'utf8' );
		
		// create a request instance for web hooks
		this.request = new Request( "SpeechBubble v" + this.server.__version );
		this.request.setTimeout( 30 * 1000 );
		this.request.setFollow( 2 );
		this.request.setAutoError( true );
		this.request.setKeepAlive( true );
		
		// cache dir listings in RAM
		this.dirCache = {};
		
		// hold all users and channels in memory forever
		this.users = {};
		this.channels = {};
		this.emoji = {};
		this.api_keys = {};
		
		async.parallel(
			[
				function(callback) {
					self.storage.listEach( 'global/users', function(item, idx, callback) {
						// do something with item, then fire callback
						self.storage.get( 'users/' + item.username, function(err, user) {
							if (user) {
								self.users[ item.username ] = Tools.copyHash(user, true);
							}
							callback();
						} );
					}, callback );
				},
				function(callback) {
					self.storage.listGet( 'global/channels', 0, 0, function(err, items) {
						if (err) return callback(err);
						items.forEach( function(channel) {
							self.channels[ channel.id ] = Tools.copyHash(channel, true);
						} );
						callback();
					});
				},
				function(callback) {
					self.storage.listGet( 'global/emoji', 0, 0, function(err, items) {
						if (err) return callback(err);
						items.forEach( function(emoji) {
							self.emoji[ emoji.id ] = Tools.copyHash(emoji, true);
						} );
						callback();
					});
				},
				function(callback) {
					self.storage.listGet( 'global/api_keys', 0, 0, function(err, items) {
						if (err) return callback(err);
						items.forEach( function(api_key) {
							self.api_keys[ api_key.id ] = Tools.copyHash(api_key, true);
						} );
						callback();
					});
				},
				function(callback) {
					// figure out current server OS dist / name
					// e.g. {"os":"linux","dist":"Centos","release":"6.5","codename":"final"}
					getos( function(err, info) {
						if (!info) info = {};
						self.os_version = Tools.ucfirst(info.os || os.platform()) + ' ' + Tools.ucfirst(info.dist || os.release());
						if (info.release) self.os_version += ' ' + info.release;
						callback();
					} ); // getos
				}
			],
			function(err) {
				if (err) return callback(err);
				
				// almost complete
				self.finishStartup(callback);
			}
		);
	},
	
	finishStartup: function(callback) {
		// complete final startup tasks
		var self = this;
		
		// preload recent channel history for all channels
		var max_rows = this.server.config.get('max_recent_channel_history');
		
		async.eachSeries( Object.keys(this.channels),
			function(chan, callback) {
				var channel = self.channels[chan];
				
				// skip private channels
				if (channel.private) return process.nextTick(callback);
				
				var timeline_path = "timeline/" + chan;
				self.logDebug(6, "Preloading channel timeline for: " + timeline_path, { max_rows: max_rows });
				
				self.storage.listGet( timeline_path, 0 - max_rows, max_rows, function(err, items) {
					// ignore error here
					if (err || !items || !items.length) return callback();
					self.logDebug(7, "Loading " + items.length + " records for: " + chan);
					
					// load all records
					var record_ids = items.map( function(item) { return item.seq_id; } );
					
					self.unbase.get( 'speech', record_ids, function(err, records) {
						if (err || !records || !records.length) return callback();
						
						channel.history = records;
						self.logDebug(7, "Channel " + chan + " history now contains " + channel.history.length + " records!");
						callback();
					}); // unbase.get
				}); // listGet
			},
			function(err) {
				if (err) return callback(err);
				
				// start WebSocket server, attach to http/https
				self.startSocketListener();
				
				// startup is complete
				self.logDebug(5, "Startup complete");
				callback();
			}
		); // eachSeries
	},
	
	tick: function() {
		// called every second
		var self = this;
		var now = Tools.timeNow(true);
		
		if (this.numSocketClients) {
			var status = {
				epoch: Tools.timeNow()
			};
			
			this.authSocketEmit( 'status', status );
		}
		
		// keep track of CPU usage (this process only)
		if (this.cpu.last) {
			var cur = process.cpuUsage( this.cpu.last );
			cur.pct = Math.floor( ((cur.user + cur.system) / 1000000) * 100 );
			this.cpu.current = cur;
		}
		this.cpu.last = process.cpuUsage();
	},
	
	beforeUserLogin: function(args, callback) {
		// infuse data into user login client response
		var self = this;
		
		args.resp = {
			epoch: Tools.timeNow()
		};
		
		callback();
	},
	
	afterUserLogin: function(args) {
		// user has logged in
	},
	
	beforeUserChange: function(args, callback) {
		// clean up user full name and nickname
		var self = this;
		var updates = args.params || {};
		var username = args.user.username;
		
		if (updates.full_name) updates.full_name = updates.full_name.replace(/[\<\>\'\"\&\r\n]+/g, '');
		if (updates.nickname) updates.nickname = updates.nickname.replace(/[\<\>\'\"\&\r\n]+/g, '');
		
		// check for nick dupe
		if (updates.nickname) {
			var lc_nick = updates.nickname.toLowerCase().trim();
			for (var key in this.users) {
				var user = this.users[key];
				if ((username != user.username) && (lc_nick == user.nickname.toLowerCase().trim())) {
					return callback( new Error("Nickname already in use: " + updates.nickname) );
				}
			}
		} // updates.nickname
		
		callback();
	},
	
	afterUserChange: function(action, args) {
		// user data has changed
		var username = args.user.username; // username cannot change
		var user = this.users[ username ] || null;
		var new_user = Tools.copyHashRemoveKeys( args.user, { password: 1, salt: 1, email: 1 } );
		
		switch (action) {
			case 'user_create':
				this.users[ username ] = new_user;
				this.doSocketBroadcastAll( 'user_updated', new_user );
			break;
			
			case 'user_update':
				var old_active = 0;
				if (user) {
					old_active = user.active;
					Tools.mergeHashInto( user, new_user );
				}
				else {
					this.users[ username ] = user = new_user;
				}
				
				this.doSocketBroadcastAll( 'user_updated', new_user );
				
				if (old_active && !user.active) {
					// user was just banned, just now
					if (user.sockets && Tools.numKeys(user.sockets)) {
						// disabled user (i.e. ban) force logout
						this.logDebug(5, "User has been banned, forcing logout: " + username);
						for (var socket_id in user.sockets) {
							var socket = user.sockets[socket_id];
							this.doUserLogout( socket );
							
							this.logDebug(9, "Closing user socket: " + socket.id);
							socket.ws.terminate();
						}
					}
				} // banned
			break;
			
			case 'avatar_change':
				// notify all channels that user is in
				/*if (user.live_channels) {
					for (var chan in user.live_channels) {
						this.doSocketChannelBroadcast( chan, 'avatar_changed', { username: username } );
					}
				}*/
				if (user) {
					// merge for new `modified` and `custom_avatar` keys
					Tools.mergeHashInto( user, new_user );
				}
				this.doSocketBroadcastAll( 'avatar_changed', { username: username } );
			break;
			
			case 'user_delete':
				if (user && user.sockets) {
					for (var socket_id in user.sockets) {
						var socket = user.sockets[socket_id];
						this.doUserLogout( socket );
					}
				}
				delete this.users[ username ];
				this.doSocketBroadcastAll( 'user_deleted', { username: username } );
			break;
		}
	},
	
	runMaintenance: function() {
		// run routine daily tasks, called after storage maint completes.
		
		// don't run this if shutting down
		if (this.server.shut) return;
	},
	
	archiveLogs: function() {
		// archive all logs (called once daily)
		var self = this;
		var src_spec = this.server.config.get('log_dir') + '/*.log';
		var dest_path = this.server.config.get('log_archive_path');
		
		if (dest_path) {
			this.logDebug(4, "Archiving logs: " + src_spec + " to: " + dest_path);
			// generate time label from previous day, so just subtracting 30 minutes to be safe
			var epoch = Tools.timeNow(true) - 1800;
			
			this.logger.archive(src_spec, dest_path, epoch, function(err) {
				if (err) self.logError('maint', "Failed to archive logs: " + err);
				else self.logDebug(4, "Log archival complete");
			});
		}
	},
	
	_uniqueIDCounter: 0,
	getUniqueID: function(prefix) {
		// generate unique id using high-res server time, and a static counter,
		// both converted to alphanumeric lower-case (base-36), ends up being ~10 chars.
		// allows for *up to* 1,296 unique ids per millisecond (sort of).
		this._uniqueIDCounter++;
		if (this._uniqueIDCounter >= Math.pow(36, 2)) this._uniqueIDCounter = 0;
		
		return [
			prefix,
			Tools.zeroPad( (new Date()).getTime().toString(36), 8 ),
			Tools.zeroPad( this._uniqueIDCounter.toString(36), 2 )
		].join('');
	},
	
	corsPreflight: function(args, callback) {
		// handler for HTTP OPTIONS calls (CORS AJAX preflight)
		callback( "200 OK", 
			{
				'Access-Control-Allow-Origin': args.request.headers['origin'] || "*",
				'Access-Control-Allow-Methods': "POST, GET, HEAD, OPTIONS",
				'Access-Control-Allow-Headers': args.request.headers['access-control-request-headers'] || "*",
				'Access-Control-Max-Age': "1728000",
				'Content-Length': "0"
			},
			null
		);
	},
	
	normalizeUsername: function(username) {
		// normalize username (lower-case alphanumeric)
		return this.usermgr.normalizeUsername( username );
	},
	
	normalizeChannelID: function(chan) {
		// normalize channel ID (lower-case alphanumeric)
		if (!chan) return '';
		return chan.toString().toLowerCase().replace(/\W+/g, '');
	},
	
	addToChannelHistory: function(chan, data) {
		// add chat or event to channel history
		// data: { type: 'standard', content: 'Hey!' }
		chan = this.normalizeChannelID( chan );
		var channel = this.channels[chan];
		if (!channel) return false;
		
		// all chats need a unique ID and timestamp
		if (!data.id) data.id = this.getUniqueID('s');
		if (!data.date) data.date = Tools.timeNow();
		if (!data.channel_id) data.channel_id = chan;
		if (!data.type) data.type = 'standard';
		
		// store last 100 or so chats in memory
		if (!channel.history) channel.history = [];
		channel.history.push( data );
		if (channel.history.length > this.server.config.get('max_recent_channel_history')) channel.history.shift();
		
		// index chat in DB / timeline here
		// skip non-user messages like system notices
		if (!channel.private && !channel.pm && !this.server.shut && data.username && data.type.match(/^(standard|code|pose|app|delete)$/)) {
			if (this.server.config.get('enable_indexer')) {
				this.indexChatMessage(data);
			}
			if ((data.type == 'standard') && data.content) {
				this.fireWebHooks(data);
			}
		}
		
		return true;
	},
	
	indexChatMessage: function(data) {
		// index chat in unbase, and timeline
		var self = this;
		if (!data.seq_id) data.seq_id = this.getUniqueID('');
		
		// add hour code for unbase
		var dargs = Tools.getDateArgs( data.date );
		var timejump_path = "timejump/" + data.channel_id + "/" + dargs.yyyy_mm_dd;
		var hour_code = 'h' + dargs.hh;
		
		var timeline_path = "timeline/" + data.channel_id;
		var opts = { page_size: 1000 };
		
		this.storage.listPush( timeline_path, { seq_id: data.seq_id }, opts, function(err, list) {
			if (err) {
				self.logError('storage', "Failed to add item to timeline: " + err);
				return;
			}
			
			// cross-ref timeline and unbase record
			data.timeline_idx = list.length - 1;
			
			self.unbase.insert( "speech", data.seq_id, data, function(err) {
				if (err) {
					self.logError('indexer', "Failed to index item: " + err);
					return;
				}
				
				// possibly add to timejump hash (first chat of every hour)
				self.storage.lock( timejump_path, true, function() {
					// locked hash
					
					self.storage.hashGetAll( timejump_path, function(err, items) {
						if (err || !items) items = {};
						
						if (!items[hour_code]) {
							// first message for hour, add to hash
							var hour_stub = { seq_id: data.seq_id, timeline_idx: data.timeline_idx };
							
							self.storage.hashPut( timejump_path, hour_code, hour_stub, function(err) {
								if (err) {
									self.logError('storage', "Failed to add stub to timejump hash: " + err);
								}
								self.storage.unlock( timejump_path );
							} ); // hashPut
						}
						else {
							// hour code already set, we're done
							self.storage.unlock( timejump_path );
						}
					} ); // hashGetAll
				} ); // lock
			} ); // unbase.insert
		} ); // listPush
	},
	
	fireWebHooks: function(data) {
		// fire API key web hooks for message
		// Note: All matching hooks are fired in parallel
		var self = this;
		if (!data.content || !data.content.match) return; // sanity check
		
		if (!this.webHookCache) {
			// pre-compile api key web hook filter matches
			this.webHookCache = [];
			for (var id in this.api_keys) {
				var api_key = this.api_keys[id];
				if (api_key.web_hook_url) {
					var re = new RegExp( api_key.web_hook_filter || '.+' );
					this.webHookCache.push({
						regex: re,
						api_key: api_key
					});
				}
			}
		} // pre-cache
		
		// iterate over each hook that has a registered url
		this.webHookCache.forEach( function(hook) {
			if (data.content.match(hook.regex)) {
				// web hook filter matched, fire hook url
				var api_key = hook.api_key;
				var url = api_key.web_hook_url;
				
				self.logDebug(9, "Firing web hook for message: " + data.id + ": " + url, {
					id: api_key.id,
					title: api_key.title
				});
				
				self.request.post( url, { json: true, data: data }, function(err, res, hook_data, perf) {
					// got response, check for error
					if (err) {
						self.logError('api', "Web hook error: " + err);
						return self.doChannelNotice(data.channel_id, {
							username: data.username,
							label: "Error",
							content: "<b>Web Hook Failed:</b> " + api_key.title + ": " + err
						});
					}
					
					var html = '' + hook_data;
					self.logDebug(9, "Received web hook response: " + html, {
						url: url,
						id: api_key.id,
						title: api_key.title,
						perf: perf.metrics()
					});
					
					// optionally post reply as api key app
					// note: infinite loop of reply/hook/reply/hook is not possible because of chat type
					if (html.length && html.match(/\S/)) {
						var message = {
							type: 'app',
							id: Tools.generateUniqueID(32, api_key.key),
							date: Tools.timeNow(),
							username: api_key.id,
							channel_id: data.channel_id,
							content: self.cleanHTML( html.trim() ),
							markdown: true,
							emoji: true
						};
						
						var chan = message.channel_id;
						var channel = self.channels[chan];
						if (!channel) {
							// sanity check
							self.logError('say', "Channel no longer found: " + chan + ", canceling web hook reply");
							return;
						}
						
						// standard say (to everyone in channel)
						self.logTransaction('say', "API Key: " + api_key.key + " spoke in channel: " + chan, message );
						
						// notify all users in channel
						self.doSocketChannelBroadcast( chan, 'said', message);
						
						// store last 1000 or so chats in memory
						self.addToChannelHistory( chan, message );
					}
				}); // request.post
			} // matched
		} ); // forEach hook
	},
	
	readdirCache: function(path, match) {
		// readdirSync, but cache results
		path = Path.resolve(path);
		if (!match) match = /^(?!\.)/;
		var obj = this.dirCache[path] || null;
		
		if (obj && (obj.time > Tools.timeNow() - 60)) {
			// fresh cache entry
			return obj.data;
		}
		
		// refresh cache
		obj = this.dirCache[path] = {
			time: Tools.timeNow(),
			data: fs.readdirSync(path).filter( function(filename) {
				return filename.match(match);
			} )
		};
		
		return obj.data;
	},
	
	cleanHTML: function(html) {
		// clean (sanitize) HTML, strip CSS colors and trim
		if (html && html.match(/<.+>/)) {
			html = sanitizeHtml(html, {
				allowedTags: ["h4", "h5", "h6", "blockquote", "p", "a", "ul", "ol", "nl", "li", "b", "i", "strong", "em", "strike", "hr", "br", "div", "table", "thead", "caption", "tbody", "tr", "th", "td", "span", "img"],
				allowedAttributes: {
					'*': [ 'href', 'style', 'class', 'src' ]
				},
				allowedStyles: {
					'*': {
						// 'font-family': [/.+/],
						// 'font-size': [/.+/],
						'font-weight': [/.+/],
						'font-style': [/.+/],
						'border': [/.+/],
						'border-top': [/.+/],
						'border-right': [/.+/],
						'border-bottom': [/.+/],
						'border-left': [/.+/],
						'margin': [/.+/],
						'margin-top': [/.+/],
						'margin-right': [/.+/],
						'margin-bottom': [/.+/],
						'margin-left': [/.+/],
						'padding': [/.+/],
						'padding-top': [/.+/],
						'padding-right': [/.+/],
						'padding-bottom': [/.+/],
						'padding-left': [/.+/],
						'text-align': [/.+/],
						'display': [/.+/],
						'vertical-align': [/.+/],
						'transform': [/.+/],
						'transform-origin': [/.+/],
						'text-transform': [/.+/],
						'text-decoration': [/.+/]
					}
				},
				allowedSchemes: sanitizeHtml.defaults.allowedSchemes.concat([ 'data' ]),
			}).trim();
			
			// strip all color (alas, with day/night themes we cannot preserve pasted colors)
			html = html.replace(/\b(style\s*\=\s*\")([^\"]*)(\")/ig, function(m_all, m_g1, m_g2, m_g3) {
				m_g2 = m_g2.replace(/(border\-|background\-)?color\:[^\;\"]*/ig, '');
				m_g2 = m_g2.replace(/\#\w+/g, '').replace(/(rgba?|hsla?)\([^\)]+\)/g, '');
				return m_g1 + m_g2 + m_g3;
			});
		}
		return html;
	},
	
	botProxy: function(args, callback) {
		// proxy request to SpeechBot
		var self = this;
		var request = args.request;
		var url = this.server.config.get('bot_proxy') + request.url;
		
		// process incoming raw headers into hash, preserve mixed case
		var raw_headers = {};
		for (var idx = 0, len = request.rawHeaders.length; idx < len; idx += 2) {
			var key = request.rawHeaders[idx];
			var value = request.rawHeaders[idx + 1];
			if (!key.match( this.req_head_scrub_regex )) {
				raw_headers[ key ] = request.headers[key.toLowerCase()] || value;
			}
		}
		
		// if front-end request was HTTPS, pass along a hint
		if (request.headers.ssl) raw_headers['X-Forwarded-Proto'] = 'https';
		
		// setup pixl-request options
		var opts = {
			method: request.method,
			headers: raw_headers
		};
		
		// augment X-Forwarded-For, like a good proxy should
		if (request.headers['x-forwarded-for']) opts.headers['X-Forwarded-For'] = request.headers['x-forwarded-for'] + ', ';
		else opts.headers['X-Forwarded-For'] = '';
		
		var ip = request.socket.remoteAddress;
		if (ip.match(/(\d+\.\d+\.\d+\.\d+)/)) ip = RegExp.$1; // extract IPv4
		
		opts.headers['X-Forwarded-For'] += ip;
		delete opts.headers['x-forwarded-for']; // just in case
		
		// pass along host header
		opts.headers['Host'] = request.headers['host'];
		
		// handle binary data / files or other
		var req_func = 'request';
		
		if (opts.method == 'POST') {
			// HTTP POST
			// preserve post parameters and/or file uploads
			req_func = 'post';
			if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'multipart/form-data';
			opts.headers['Content-Type'] = opts.headers['Content-Type'].replace(/\;.+$/, '');
			delete opts.headers['content-type']; // just in case
			
			switch (opts.headers['Content-Type']) {
				case 'multipart/form-data':
					var files = args.files;
					opts.data = Tools.copyHashRemoveKeys(args.params, files);
					
					opts.files = {};
					for (var key in files) {
						var file = files[key];
						opts.files[key] = [ file.path, file.name ];
					}
				break;
				
				case 'application/x-www-form-urlencoded':
					opts.data = args.params;
				break;
				
				default:
					if (args.params.raw) opts.data = args.params.raw;
				break;
			} // switch content-type
		}
		else {
			// HTTP GET or other
			if (args.params.raw) opts.data = args.params.raw;
		}
		
		this.logDebug(8, "Proxying " + request.method + " request to: " + url, opts.headers);
		
		// actually send request now
		this.request[req_func]( url, opts, function(err, resp, data, perf) {
			// request complete
			
			// if we had a hard error, mock up a HTTP response for it
			if (err && !resp) {
				resp = {
					statusCode: 500,
					statusMessage: "Internal Server Error",
					rawHeaders: [],
					headers: {}
				};
				data = err.toString();
			}
			
			// downstream proxy request completed
			var metrics = perf ? perf.metrics() : {};
			
			self.logDebug(8, "Proxy request completed: HTTP " + resp.statusCode + " " + resp.statusMessage, {
				resp_headers: resp.headers,
				perf_metrics: metrics
			});
			
			// preserve raw response headers
			var raw_headers = {};
			for (var idx = 0, len = resp.rawHeaders.length; idx < len; idx += 2) {
				var key = resp.rawHeaders[idx];
				var value = resp.rawHeaders[idx + 1];
				if (!key.match( self.resp_head_scrub_regex )) {
					raw_headers[ key ] = resp.headers[key.toLowerCase()] || value;
				}
			}
			
			// pass response back to original client
			callback( '' + resp.statusCode + ' ' + resp.statusMessage, raw_headers, data );
		} ); // request
	},
	
	logTransaction: function(code, msg, data) {
		// proxy request to system logger with correct component for dedi trans log
		this.logger.set( 'component', 'Transaction' );
		this.logger.transaction( code, msg, data );
	},
	
	shutdown: function(callback) {
		// shutdown sequence
		var self = this;
		this.shut = true;
		
		this.logDebug(2, "Shutting down SpeechBubble");
		
		this.stopSocketListener( callback );
	}
	
});
