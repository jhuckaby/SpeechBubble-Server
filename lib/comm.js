// SpeechBubble Server Communication Layer
// Copyright (c) 2017 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var cp = require('child_process');
var assert = require("assert");
var async = require("async");
var WebSocket = require('ws');

var Class = require("pixl-class");
var Tools = require("pixl-tools");

module.exports = Class.create({

	sockets: null,
	
	startSocketListener: function() {
		// start listening for websocket connections
		var self = this;
		
		this.numSocketClients = 0;
		this.sockets = {};
		
		this.wss = new WebSocket.Server({ server: this.web.http });
		this.wss.on('connection', this.handleNewSocket.bind(this));
		
		this.wss.on('error', function(err) {
			self.logError('ws', "WebSocket Server Error: " + err);
		});
		
		if (this.web.https) {
			// HTTPS listener
			this.wsss = new WebSocket.Server({ server: this.web.https });
			this.wsss.on('connection', this.handleNewSocket.bind(this));
			
			this.wsss.on('error', function(err) {
				self.logError('ws', "WebSocket Server Error: " + err);
			});
		}
		
		// update socket stats every minute
		this.server.on('minute', function() {
			self.updateSocketStats();
		} );
	},
	
	handleNewSocket: function(web_socket, req) {
		// handle new socket connection from ws
		var self = this;
		var ip = req.connection.remoteAddress || socket.client.conn.remoteAddress || 'Unknown';
		
		// custom socket abstraction layer
		var socket = {
			ws: web_socket,
			request: req,
			auth: false,
			disconnected: false,
			id: Tools.generateUniqueID( 32 ),
			ip: ip,
			timeStart: Tools.timeNow(),
			lastPing: Tools.timeNow(),
			metadata: {
				last_event_time: Tools.timeNow()
			},
			
			emit: function(cmd, data) {
				self.logDebug(10, "Sending socket reply: " + cmd, data);
				if (this.ws.readyState === WebSocket.OPEN) {
					this.ws.send( JSON.stringify({ cmd: cmd, data: data }) );
				}
			}
		};
		
		this.numSocketClients++;
		this.sockets[ socket.id ] = socket;
		this.logDebug(5, "New WebSocket client connected: " + socket.id + " (IP: " + ip + ")");
		
		web_socket.on('message', function(message) {
			// receive message from socket
			var json = null;
			try { json = JSON.parse(message); }
			catch(err) {
				self.logDebug(3, "Socket error: Failed to parse JSON: " + err, message);
				return;
			}
			self.handleSocketMessage(socket, json);
		});
		
		web_socket.on('error', function(err) {
			// web socket error
			self.logError('socket', "Client socket error: " + socket.id + ": " + err);
		} );
		
		web_socket.on('close', function() {
			// client disconnected
			if (socket.auth) {
				self.doUserDisconnect(socket);
			}
			
			socket.disconnected = true;
			self.numSocketClients--;
			delete self.sockets[ socket.id ];
			self.logDebug(5, "WebSocket client disconnected: " + socket.id + " (IP: " + ip + ")");
		} );
	},
	
	handleSocketMessage: function(socket, json) {
		// receive JSON message from socket
		var self = this;
		if (json.cmd != 'hey') this.logDebug(9, "Got message from socket: " + socket.id, json);
		
		var cmd = json.cmd;
		var data = json.data;
		
		switch(cmd) {
			case 'authenticate':
				// client is trying to authenticate
				self.logDebug(9, "Incoming socket request:", data);
				
				if (data.username && data.password) {
					self.api.invoke( '/api/user/login', data, function(resp) {
						if (!resp.code) {
							// login successful!
							self.doUserLogin(socket, resp);
						}
						else {
							// login error
							socket.emit( 'auth_failure', { description: resp.description } );
						}
					} ); // api_login
				}
				else if (data.session_id) {
					self.api.invoke( '/api/user/resume_session', data, function(resp) {
						if (!resp.code) {
							// login successful!
							self.doUserLogin(socket, resp);
						}
						else {
							// login error
							socket.emit( 'auth_failure', { description: resp.description } );
						}
					} ); // api_login
				}
				else if (data.api_key) {
					// login via API Key
					self.apiKeyLogin( data, function(resp) {
						if (!resp.code) {
							// login successful!
							self.doUserLogin(socket, resp);
						}
						else {
							// login error
							socket.emit( 'auth_failure', { description: resp.description } );
						}
					} ); // api key login
				}
				else {
					// be deliberately vague
					socket.emit( 'auth_failure', { description: "User not found or invalid password." } );
				}
			break;
			
			case 'speechbubble':
				// speechbubble command handler
				if (socket.auth) {
					self.doSocketCommand( data, socket );
				}
			break;
			
			case 'hey':
				// our own custom ping (WS already has a 'ping' event)
				// this also allows the client to tell us things like app idle time (last_event_time)
				socket.lastPing = Tools.timeNow();
				Tools.mergeHashInto( socket.metadata, data );
			break;
			
			case 'echoback':
				// response from echo
				if (data.id == socket.metadata.echo_id) {
					var now = Tools.timeNow();
					var ping_ms = Math.floor( (now - socket.metadata.echo_time) * 1000 );
					socket.metadata.ping_ms = ping_ms;
					this.logDebug(9, "Socket Ping: " + ping_ms + " ms", {
						id: socket.id, ip: socket.ip, username: socket.metadata.username
					});
				}
				else socket.metadata.ping_ms = 0;
			break;
			
			case 'logout':
				// user wants out?  okay then
				if (socket.auth) {
					self.doUserLogout(socket);
				}
			break;
		} // switch cmd
	},
	
	apiKeyLogin: function(params, callback) {
		// login via api key
		var args = {
			request: {
				method: "INTERNAL",
				url: '',
				headers: { 'host': 'Internal', 'user-agent': 'Internal' }
			},
			response: {},
			query: {},
			matches: [],
			params: params,
			files: {},
			cookies: {},
			ip: '0.0.0.0',
			ips: ['0.0.0.0'],
			server: this.server
		};
		
		this.loadSession( args, function(err, session, user) {
			if (err) return callback(err);
			
			// successful "login", simulate login response
			callback({
				code: 0, 
				username: session.api_key,
				user: user
			});
		} ); // loadSession
	},
	
	doUserLogin: function(socket, resp) {
		// finish logging user in
		var username = resp.username; // normalized
		this.logDebug(5, "Authentication successful, user has logged in: " + username + " (" + socket.ip + ")", resp);
		
		socket.auth = true;
		if (!socket.metadata) socket.metadata = {};
		socket.metadata.username = username;
		socket.metadata.session_id = resp.session_id;
		socket.metadata.last_bytes_in = 0;
		socket.metadata.last_bytes_out = 0;
		
		// add all users to resp
		resp.users = {};
		for (var key in this.users) {
			resp.users[key] = Tools.copyHashRemoveKeys( this.users[key], { sockets: 1, password: 1, salt: 1, live_channels: 1 } );
		}
		
		// add all applicable channels to resp
		resp.channels = {};
		for (var chan in this.channels) {
			var channel = this.channels[chan];
			if (channel.pm) {
				if (channel.users[username]) {
					resp.channels[chan] = Tools.copyHashRemoveKeys( channel, { live_users: 1, history: 1 } );
				}
			}
			else {
				if (resp.user.privileges.admin || !channel.private || channel.users[username]) {
					resp.channels[chan] = Tools.copyHashRemoveKeys( channel, { live_users: 1, history: 1 } );
				}
			}
		}
		
		// add api keys to resp
		// resp.api_keys = this.api_keys;
		resp.api_keys = {};
		for (var id in this.api_keys) {
			resp.api_keys[id] = Tools.copyHashRemoveKeys( this.api_keys[id], { key: 1 } );
		}
		
		// add custom emoji to resp
		resp.emoji = this.emoji;
		
		// add emoji sound list to resp
		resp.emoji_sounds = this.readdirCache('htdocs/sounds/emoji').map( function(item) {
			return item.replace(/\.\w+$/, '');
		} );
		
		// also add client chunk of our config (has status_map, etc.)
		resp.config = Tools.mergeHashes( this.server.config.get('client'), {
			base_app_url: this.server.config.get('base_app_url'),
			max_message_content_length: this.server.config.get('max_message_content_length') || 8192
		} );
		
		socket.emit( 'login', resp );
		
		// cache user in memory
		if (!this.users[username]) this.users[username] = Tools.copyHash(resp.user);
		var user = this.users[username];
		
		if (!user.login_time) user.login_time = Tools.timeNow();
		user.ip = socket.ip || 'Unknown';
		user.last_cmd_time = 0;
		user.last_cmd = '';
		
		if (!user.sockets) user.sockets = {};
		user.sockets[ socket.id ] = socket;
		
		this.logDebug(5, "User now has " + Tools.numKeys(user.sockets) + " sockets connected", Object.keys(user.sockets));
	},
	
	doSocketCommand: function(data, socket) {
		// execute incoming chat command on the server
		if (this.shut) return;
		
		var username = socket.metadata.username;
		var user = this.users[username];
		var cmd = data.cmd;
		delete data.cmd;
		
		this.logDebug(9, "Incoming socket command: " + cmd + " for user: " + username, data);
		
		var args = {
			socket: socket,
			cmd: cmd,
			data: data,
			username: username,
			user: user
		};
		
		var func = 'cmd_' + args.cmd.replace(/\W+/g, '');
		if (this[func]) this[func]( args );
		
		user.last_cmd_time = Tools.timeNow(true);
	},
	
	doSocketReply: function(cmd, data, args) {
		// send command reply to single socket
		if (this.shut) return;
		
		assert( arguments.length == 3, "Wrong number of arguments to doSocketReply" );
		var username = args.socket.metadata.username;
		data.cmd = cmd;
		
		this.logDebug(7, "Sending socket reply: " + cmd + " for user: " + username, data);
		
		args.socket.emit( 'speechbubble', data );
		return false;
	},
	
	doSocketError: function(code, msg, args) {
		// send socket error to client
		assert( arguments.length == 3, "Wrong number of arguments to doSocketError" );
		this.doSocketReply('error', { code: code, description: msg }, args);
	},
	
	doSocketBroadcastAll: function(cmd, orig_data) {
		// send command to all users
		if (this.shut) return;
		var data = Tools.copyHash(orig_data);
		data.cmd = cmd;
		
		this.logDebug(7, "Sending broadcast to all users: " + cmd, data);
		
		for (var username in this.users) {
			var user = this.users[username];
			if (user.sockets) {
				for (var id in user.sockets) {
					var socket = user.sockets[id];
					if (socket.auth) socket.emit( 'speechbubble', data );
				} // foreach socket
			} // user.sockets
		} // foreach user
	},
	
	doSocketChannelBroadcast: function(channel, cmd, orig_data) {
		// send command to all users in specific channel
		if (this.shut) return;
		var data = Tools.copyHash(orig_data);
		
		if (typeof(channel) == 'string') channel = this.channels[channel];
		assert( !!channel, "Channel not found for broadcast" );
		data.cmd = cmd;
		
		this.logDebug(7, "Sending channel broadcast: " + cmd + " for channel: " + channel.id, data);
		
		if (channel.live_users) {
			for (var username in channel.live_users) {
				var user = this.users[username];
				if (user.sockets) {
					for (var id in user.sockets) {
						var socket = user.sockets[id];
						if (socket.auth) socket.emit( 'speechbubble', data );
					} // foreach socket
				} // user.sockets
			} // foreach user
		} // channel.live_users
	},
	
	doSocketUserBroadcast: function(user, cmd, orig_data) {
		// send command to all user sockets (user may be logged in twice)
		if (this.shut) return;
		var data = Tools.copyHash(orig_data);
		
		if (typeof(user) == 'string') user = this.users[user];
		// assert( !!user, "User not found for broadcast" );
		if (!user) {
			this.logError('user', "User not found for socket broadcast");
			return;
		}
		data.cmd = cmd;
		
		if (user.sockets) {
			this.logDebug(7, "Sending user broadcast: " + cmd + " for user: " + user.username, data);
			
			for (var id in user.sockets) {
				var socket = user.sockets[id];
				if (socket.auth) socket.emit( 'speechbubble', data );
			} // foreach socket
		} // user.sockets
	},
	
	doUserLogout: function(socket) {
		// log user out
		var username = socket.metadata.username;
		this.logDebug(5, "User is logging out: " + username + " (" + socket.id + ")");
		
		socket.auth = false;
		
		var user = this.users[username];
		if (!user || !user.sockets) return; // should never happen
		delete user.sockets[ socket.id ];
		
		if (!Tools.numKeys(user.sockets)) {
			// all sockets for user have logged out, so notify all channels
			this.logDebug(5, "All sockets for user have logged out: " + username);
			
			// notify all channels that user was in
			if (user.live_channels) {
				for (var chan in user.live_channels) {
					this.userLeaveChannel( username, chan, "logout" );
				}
			}
			
			delete user.sockets;
			delete user.login_time;
			delete user.ip;
			// delete user.last_cmd_time;
			// delete user.last_cmd;
			user.logout_time = Tools.timeNow();
		}
		else {
			this.logDebug(5, "User still has " + Tools.numKeys(user.sockets) + " sockets connected", Object.keys(user.sockets));
		}
	},
	
	doUserDisconnect: function(socket) {
		// user websocket has disconnected
		var username = socket.metadata.username;
		this.logDebug(5, "User socket has disconnected: " + username + " (" + socket.id + ")", { ip: socket.ip });
		
		socket.auth = false;
		
		var user = this.users[username];
		if (!user || !user.sockets) return; // should never happen
		delete user.sockets[ socket.id ];
		
		if (!Tools.numKeys(user.sockets)) {
			// all sockets for user have logged out, so notify all channels
			this.logDebug(5, "All sockets for user have disconnected: " + username);
			
			// notify all channels that user was in
			if (user.live_channels) {
				for (var chan in user.live_channels) {
					this.userLeaveChannel( username, chan, "disconnect" );
				}
			}
			
			delete user.sockets;
			delete user.login_time;
			delete user.ip;
			// delete user.last_cmd_time;
			// delete user.last_cmd;
			user.logout_time = Tools.timeNow();
		}
		else {
			this.logDebug(5, "User still has " + Tools.numKeys(user.sockets) + " sockets connected", Object.keys(user.sockets));
		}
	},
	
	userLeaveChannel: function(username, chan, reason, who) {
		// user will leave channel, possibly by force
		var user = this.users[username];
		var channel = this.channels[chan];
		
		assert( !!user, "User not found" );
		assert( !!channel, "Channel not found" );
		
		var username = user.username;
		
		this.logTransaction('user_leave', "User: " + username + " is leaving channel: " + chan, { username: username, channel: chan, reason: reason } );
		
		// remove user from channel
		if (!channel.live_users) channel.live_users = {};
		delete channel.live_users[username];
		
		// remove channel from user
		if (!user.live_channels) user.live_channels = {};
		delete user.live_channels[chan];
		
		var nice_reason = '';
		switch (reason) {
			case 'self': nice_reason = "has left the channel."; break;
			case 'logout': nice_reason = "has logged out."; break;
			case 'disconnect': nice_reason = "has disconnected from the server."; break;
			case 'private': nice_reason = "was kicked, due to the channel becoming private."; break;
			case 'delete': nice_reason = "was kicked, due to their account being deleted."; break;
			case 'kick': nice_reason = "was kicked by " + who + "."; break;
		}
		
		// notify all users still in channel
		this.doSocketChannelBroadcast( chan, 'left', {
			channel_id: chan,
			username: username,
			reason: reason,
			nice_reason: nice_reason
		});
		
		// send user who left a goodbye packet
		if ((reason != 'logout') && (reason != 'disconnect')) {
			this.doSocketUserBroadcast( user, 'goodbye', { 
				channel_id: chan, 
				reason: reason, 
				nice_reason: nice_reason 
			} );
		}
		
		// log event
		var user_disp = user.full_name;
		if (!user.full_name.match(new RegExp("\\b" + Tools.escapeRegExp(user.nickname) + "\\b", "i"))) {
			user_disp += " (" + user.nickname + ")";
		}
		
		this.addToChannelHistory( chan, {
			type: 'notice',
			label: "User",
			content: "<b>" + user_disp + "</b> " + nice_reason,
			reason: reason
		} );
		
		// last user left a private channel?  delete to release memory
		if (channel.pm && !Tools.numKeys(channel.live_users)) {
			this.logDebug(5, "No more users in temp private channel, deleting: " + chan);
			delete this.channels[chan];
		}
	},
	
	broadcastChannelUpdate: function(channel) {
		// broadcast channel update to all applicable users
		var update = Tools.copyHashRemoveKeys( channel, { live_users: 1 } );
		
		for (var username in this.users) {
			var user = this.users[username];
			
			if (user.sockets && (user.privileges.admin || !channel.private || channel.users[username])) {
				this.doSocketUserBroadcast( user, 'channel_updated', {
					channel_id: channel.id,
					channel: update
				} );
			}
		} // foreach user
	},
	
	authSocketEmit: function(key, data) {
		// Only emit to authenticated clients
		// Emits raw key/value, not wrapped in speechbubble
		if (this.shut) return;
		
		// this.logDebug(10, "Emitting to all authenticated sockets: " + key, data);
		
		for (var id in this.sockets) {
			var socket = this.sockets[id];
			if (socket.auth) socket.emit( key, data );
		}
	},
	
	updateSocketStats: function() {
		// update bytes in/out for all sockets
		if (this.shut) return;
		var now = Tools.timeNow();
		
		for (var id in this.sockets) {
			var socket = this.sockets[id];
			if (socket.auth) {
				var cur_bytes_in = socket.request.connection.bytesRead || 0;
				var cur_bytes_out = socket.request.connection.bytesWritten || 0;
				
				var delta_bytes_in = cur_bytes_in - socket.metadata.last_bytes_in;
				var delta_bytes_out = cur_bytes_out - socket.metadata.last_bytes_out;
				
				// update global stats
				if (!this.stats.bytes_in) this.stats.bytes_in = 0;
				this.stats.bytes_in += delta_bytes_in;
				
				if (!this.stats.bytes_out) this.stats.bytes_out = 0;
				this.stats.bytes_out += delta_bytes_out;
				
				// update for next minute
				socket.metadata.last_bytes_in = cur_bytes_in;
				socket.metadata.last_bytes_out = cur_bytes_out;
			}
			
			// check for ping death
			if (!socket.disconnected && (now - socket.lastPing >= 300)) {
				this.logDebug(5, "Socket ping death: " + socket.id + " (" + socket.ip + ")", socket.metadata);
				socket.ws.terminate();
			}
			else {
				// measure round-trip time (RTT)
				socket.metadata.echo_time = Tools.timeNow();
				socket.metadata.echo_id = this.getUniqueID('e');
				socket.emit('echo', { id: socket.metadata.echo_id } );
			}
		}
	},
	
	doChannelNotice: function(chan, orig_data) {
		// send notice to channel
		var data = Tools.copyHash( orig_data );
		chan = data.channel_id = this.normalizeChannelID( chan );
		var channel = this.channels[chan];
		if (!channel) {
			this.logError('channel', "Cannot send notice, channel not found: " + chan, data);
			return false;
		}
		
		data.id = this.getUniqueID('n');
		data.date = Tools.timeNow();
		data.type = 'notice';
		
		this.logTransaction('notice', "Notice posted to channel: " + chan, data );
		
		// notify all users in channel
		this.doSocketChannelBroadcast( chan, 'said', data);
		
		// store last 1000 or so chats in memory
		this.addToChannelHistory(chan, data);
		
		return true;
	},
	
	shutdownServer: function(args) {
		// shut down server
		if (this.server.debug) {
			this.logDebug(5, "Skipping shutdown command, as we're in debug mode.");
			return;
		}
		
		this.logDebug(1, "Shutting down server: " + (args.reason || 'Unknown reason'));
		
		// issue shutdown command
		this.server.shutdown();
	},
	
	restartServer: function(args) {
		// restart server, but only if in daemon mode
		if (this.server.debug) {
			this.logDebug(5, "Skipping restart command, as we're in debug mode.");
			return;
		}
		
		this.logDebug(1, "Restarting server: " + (args.reason || 'Unknown reason'));
		
		// issue a restart command by shelling out to our control script in a detached child
		child = cp.spawn( "bin/control.sh", ["restart"], { 
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore'] 
		} );
		child.unref();
	},
	
	stopSocketListener: function(callback) {
		// shut down websocket servers
		var self = this;
		
		async.parallel(
			[
				function(callback) {
					if (self.wss) self.wss.close( callback );
					else callback();
				},
				function(callback) {
					if (self.wsss) self.wsss.close( callback );
					else callback();
				}
			],
			callback
		);
	}
	
});
