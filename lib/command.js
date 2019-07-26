// SpeechBubble Server Command Layer
// Copyright (c) 2017 Joseph Huckaby
// Released under the MIT License

var Class = require("pixl-class");
var Tools = require("pixl-tools");
var async = require('async');

module.exports = Class.create({
	
	// args: socket, data, user, username
	
	cmd_ping: function(args) {
		// client sent a ping
		var user = args.user;
		user.last_ping = Tools.timeNow();
		
		this.doSocketReply( 'pong', { epoch: Tools.timeNow() }, args );
	},
	
	cmd_pm: function(args) {
		// open private message session with user
		// args.data: { username: USERNAME }
		var data = args.data;
		var username = args.username;
		var user = args.user;
		
		var dest_username = this.normalizeUsername(data.username);
		var dest_user = this.users[dest_username];
		if (!dest_user) {
			return this.doSocketError('user', "User not found: " + dest_username, args);
		}
		if (dest_username == username) {
			return this.doSocketError('user', "Cannot join private IM with self: " + dest_username, args);
		}
		
		// make sure ID always hashes to the same for the same two users, no matter who invites who
		var chan = 'pm_' + Tools.digestHex( [username, dest_username].sort().join('-'), 'md5' );
		
		// keep 'channel' in memory only, do not persist to disk
		if (!this.channels[chan]) this.channels[chan] = {
			id: chan,
			title: '(PM)', // will be replaced client-side
			topic: '(Private Chat)',
			founder: username,
			private: 1,
			pm: 1,
			users: {}
		};
		var channel = this.channels[chan];
		
		channel.users[username] = { admin: 1 };
		channel.users[dest_username] = { admin: 1 };
		
		this.logDebug(6, "Creating new temp PM channel: " + channel.id, channel);
		
		// broadcast channel update to our two users ONLY
		var update = Tools.copyHashRemoveKeys( channel, { live_users: 1 } );
		
		for (var username in channel.users) {
			var user = this.users[username];
			
			if (user.sockets) {
				this.doSocketUserBroadcast( user, 'channel_updated', {
					channel_id: channel.id,
					channel: update
				} );
			}
		} // foreach pm user
	},
	
	cmd_join: function(args) {
		// join a channel
		// args.data: { channel_id: CHANNEL_ID }
		var data = args.data;
		var chan = this.normalizeChannelID( data.channel_id );
		var channel = this.channels[chan];
		if (!channel) return this.doSocketError('channel', "Channel not found: " + chan, args);
		
		var username = args.username;
		var user = args.user;
		
		if (channel.private && !user.privileges.admin && !channel.users[username]) {
			return this.doSocketError('channel', "You do not have access to private channel: " + chan, args);
		} // private
		
		this.logTransaction('user_join', "User: " + username + " is joining channel: " + chan, { username: username, channel: chan } );
		
		// check if this is user's first join (try to prevent dupes with multiple logins)
		var first_join = false;
		if (!channel.live_users || !channel.live_users[username]) first_join = true;
		
		// add user to live channel
		if (!channel.live_users) channel.live_users = {};
		channel.live_users[username] = { live: 1 };
		
		// add channel to user
		if (!user.live_channels) user.live_channels = {};
		user.live_channels[chan] = { live: 1 };
		
		// notify all users in channel
		this.doSocketChannelBroadcast( chan, 'joined', {
			channel_id: chan,
			username: username,
			user: Tools.copyHashRemoveKeys(user, { sockets: 1, live_channels: 1, password: 1, salt: 1, email: 1 })
		});
		
		// only add joined event to channel history if this is the user's first socket
		if (first_join) {
			var user_disp = user.full_name;
			if (!user.full_name.match(new RegExp("\\b" + Tools.escapeRegExp(user.nickname) + "\\b", "i"))) {
				user_disp += " (" + user.nickname + ")";
			}
			
			this.addToChannelHistory( chan, {
				type: 'notice',
				label: "User",
				content: "<b>" + user_disp + "</b> has joined the channel."
			} );
		}
		
		// send user welcome packet for channel (includes recent history)
		var packet = {
			channel_id: chan,
			channel: Tools.copyHashRemoveKeys(channel, { users: 1 } )
			// users: {}
		};
		
		/*for (var cusername in channel.live_users) {
			var cuser = Tools.copyHashRemoveKeys( this.users[cusername], { sockets: 1, live_channels: 1, password: 1, email: 1 } );
			packet.users[cusername] = cuser;
		}*/
		
		this.doSocketUserBroadcast( username, 'welcome', packet );
	},
	
	cmd_say: function(args) {
		// say something in a channel
		// args.data: { channel_id: CHANNEL_ID, type: 'standard', content: 'Hey!' }
		var data = args.data || {};
		var chan = data.channel_id = this.normalizeChannelID( data.channel_id );
		var channel = this.channels[chan];
		if (!channel) return this.doSocketError('channel', "Channel not found: " + chan, args);
		if (!data.type) return this.doSocketError('channel', "Chat message has no type", args);
		
		var username = args.username;
		var user = args.user;
		
		if (!channel.live_users) channel.live_users = {};
		if (!channel.live_users[username]) {
			return this.doSocketError('channel', "You are not currently in channel: " + chan, args);
		}
		
		// all chats need a unique ID and timestamp
		// data.id = this.getUniqueID('s'); // Hmm, generate this client-side, so we can de-dupe it with the local echo?
		data.date = Tools.timeNow();
		data.username = username;
		
		// sanitize content
		if (data.content && (data.type != 'code')) {
			data.content = this.cleanHTML( data.content );
		}
		// chop after max chat content length, for sanity
		var mm_cont_len = this.server.config.get('max_message_content_length') || 8192;
		if (data.content && data.content.length && (data.content.length > mm_cont_len)) {
			data.content = data.content.substring(0, mm_cont_len - 3) + "...";
		}
		
		if (data.type == 'whisper') {
			// special whisper type, only sent to one user and not logged
			var whisper_to = this.normalizeUsername( data.to );
			var whisper_user = this.users[ whisper_to ];
			
			if (!whisper_user) {
				return this.doSocketError('channel', "User " + whisper_to + " could not be found.", args);
			}
			if (!channel.live_users[whisper_to]) {
				return this.doSocketError('channel', "User " + whisper_to + " is not currently in channel: " + chan, args);
			}
			
			this.doSocketUserBroadcast( whisper_user, 'said', data );
		}
		else {
			// add seq_id for cross-referencing (DB, reactions, etc.)
			if (!channel.private && !channel.pm && data.username && data.type.match(/^(standard|code|pose|app|delete)$/)) {
				data.seq_id = this.getUniqueID('');
			}
			
			// standard say (to everyone in channel)
			this.logTransaction('say', "User: " + username + " spoke in channel: " + chan, data );
			
			// notify all users in channel
			this.doSocketChannelBroadcast( chan, 'said', data);
			
			// store last 1000 or so chats in memory
			this.addToChannelHistory(chan, data);
		}
	},
	
	cmd_leave: function(args) {
		// leave a channel
		// args.data: { channel_id: CHANNEL_ID }
		var data = args.data;
		var chan = this.normalizeChannelID( data.channel_id );
		var channel = this.channels[chan];
		if (!channel) return this.doSocketError('channel', "Channel not found: " + chan, args);
		
		var username = args.username;
		var user = args.user;
		
		if (!channel.live_users) channel.live_users = {};
		if (!channel.live_users[username]) {
			return this.doSocketError('channel', "You are not currently in channel: " + chan, args);
		}
		
		this.userLeaveChannel( username, chan, "self" );
	},
	
	cmd_kick: function(args) {
		// kick user from channel, must be channel admin or full admin
		// args.data: { channel_id, username }
		var data = args.data;
		var chan = this.normalizeChannelID( data.channel_id );
		var channel = this.channels[chan];
		if (!channel) return this.doSocketError('channel', "Channel not found: " + chan, args);
		
		var username = args.username;
		var user = args.user;
		
		if (!user.privileges.admin && (!channel.users[username] || !channel.users[username].admin)) {
			return this.doSocketError('channel', "You do not have administrator privileges in channel: " + channel.title, args);
		}
		
		if (!channel.live_users) channel.live_users = {};
		if (!channel.live_users[data.username]) {
			return this.doSocketError('channel', "User " + data.username + " is not currently in channel: " + chan, args);
		}
		
		this.userLeaveChannel( data.username, chan, "kick", user.nickname || username );
	},
	
	cmd_ban: function(args) {
		// ban user (disable account), full admin only
		// args.data: { username }
		var self = this;
		var data = args.data;
		var username = args.username;
		var user = args.user;
		
		if (!user.privileges.admin) {
			return this.doSocketError('admin', "You do not have administrator privileges.", args);
		}
		
		var params = {
			session_id: args.socket.metadata.session_id,
			username: data.username,
			active: 0
		};
		
		this.api.invoke( '/api/user/admin_update', params, function(resp) {
			if (!resp.code) {
				// update successful!
				// all applicable users should be notified via afterUserChange hook
				self.logTransaction('ban', "User: " + data.username + " was banned by: " + username, data );
				self.doSocketReply( 'notice', { content: "User successfully banned: " + data.username }, args );
			}
			else {
				// update error
				self.doSocketError('admin', "User update failed: " + data.username + ": " + resp.description, args);
			}
		} ); // api_admin_update
	},
	
	cmd_unban: function(args) {
		// unban user (enable account), full admin only
		// args.data: { username }
		var self = this;
		var data = args.data;
		var username = args.username;
		var user = args.user;
		
		if (!user.privileges.admin) {
			return this.doSocketError('admin', "You do not have administrator privileges.", args);
		}
		
		var params = {
			session_id: args.socket.metadata.session_id,
			username: data.username,
			active: 1
		};
		
		this.api.invoke( '/api/user/admin_update', params, function(resp) {
			if (!resp.code) {
				// update successful!
				// all applicable users should be notified via afterUserChange hook
				self.logTransaction('unban', "User: " + data.username + " was unbanned by: " + username, data );
				self.doSocketReply( 'notice', { content: "User successfully unbanned: " + data.username }, args );
			}
			else {
				// update error
				self.doSocketError('admin', "User update failed: " + data.username + ": " + resp.description, args);
			}
		} ); // api_admin_update
	},
	
	cmd_typing: function(args) {
		// user is currently typing in a channel
		// args.data: { channel_id: CHANNEL_ID }
		var data = args.data;
		var chan = data.channel_id = this.normalizeChannelID( data.channel_id );
		var channel = this.channels[chan];
		if (!channel) return this.doSocketError('channel', "Channel not found: " + chan, args);
		
		// add username to packet and broadcast
		data.username = args.username;
		
		// notify all users in channel
		this.doSocketChannelBroadcast( chan, 'typing', data);
	},
	
	cmd_status: function(args) {
		// change user status, self only
		// args.data: { status, hint, quiet }
		var self = this;
		var data = args.data;
		var username = args.username;
		var user = args.user;
		var client = this.server.config.get('client');
		
		// special case: large_blue_circle is ALWAYS the default 'Available' status
		if (data.status == 'large_blue_circle') {
			data.status = '';
			data.hint = '';
		}
		
		// very special case: only allow `desktop_computer` (i.e. screensaver) status
		// if the current user socket has the latest client activity time (last_event_time)
		// (this is for handling multi-socket connections for same user)
		if ((data.status == 'desktop_computer') && data.quiet) {
			var cur_last_event_time = args.socket.metadata.last_event_time || 0;
			var ok_go = true;
			
			for (var id in user.sockets) {
				var socket = user.sockets[id];
				var last_event_time = socket.metadata.last_event_time || 0;
				if (last_event_time > cur_last_event_time) {
					// another socket has more recent activity
					ok_go = false;
					
					this.logDebug(9, "Ignoring screensaver (desktop_computer + quiet) status, as this socket has an older client activity time", {
						username: username,
						cur_socket_id: args.socket.id,
						cur_last_event_time: cur_last_event_time,
						other_socket_id: id,
						other_last_event_time: last_event_time
					});
					
					// send user_updated reply to current socket only, so that it knows status failed to apply
					// (we want it to keep trying every minute, in case the other user socket(s) drop off)
					this.doSocketReply( 'user_updated', {
						username: username,
						nickname: user.nickname,
						full_name: user.full_name,
						status: user.status || '',
						status_hint: user.status_hint || ''
					}, args );
					
					break;
				}
			}
			
			if (!ok_go) return;
		} // screensaver socket battle
		
		var params = {
			session_id: args.socket.metadata.session_id,
			username: username,
			status: data.status || '',
			status_hint: data.hint || ''
		};
		
		this.api.invoke( '/api/app/user_update', params, function(resp) {
			if (!resp.code) {
				// update successful!
				user.status = params.status;
				user.status_hint = params.status_hint;
				
				if (!data.quiet) {
					var status_emoji = user.status || 'large_blue_circle';
					var status_text = params.status_hint || client.status_map[status_emoji] || 'Away';
					
					var user_disp = user.full_name;
					if (!user.full_name.match(new RegExp("\\b" + Tools.escapeRegExp(user.nickname) + "\\b", "i"))) {
						user_disp += " (" + user.nickname + ")";
					}
					
					var msg = "<b>" + user_disp + "</b> is now ";
					msg += ':' + status_emoji + ': <b>' + status_text + '</b>.';
					
					var notice = {
						username: username,
						label: "User",
						content: msg
					};
					
					for (var chan in self.channels) {
						var channel = self.channels[chan];
						if (channel.live_users && channel.live_users[username]) {
							self.doChannelNotice(chan, notice);
						}
					}
				} // not quiet
			}
			else {
				// update error
				self.doSocketError('user', "User update failed: " + username + ": " + resp.description, args);
			}
		} ); // api_update
	},
	
	cmd_nick: function(args) {
		// change user nick, self only
		// args.data: { nickname }
		var self = this;
		var data = args.data;
		var username = args.username;
		var user = args.user;
		
		var params = {
			session_id: args.socket.metadata.session_id,
			username: username,
			nickname: data.nickname
		};
		
		this.api.invoke( '/api/app/user_update', params, function(resp) {
			if (!resp.code) {
				// update successful!
				// all applicable users should be notified via afterUserChange hook
				self.logTransaction('status', "User: " + username + " set nick to: " + data.nickname, data );
			}
			else {
				// update error
				self.doSocketError('user', "User update failed: " + username + ": " + resp.description, args);
			}
		} ); // api_update
	},
	
	cmd_topic: function(args) {
		// change channel topic
		// args.data: { channel_id, topic }
		var self = this;
		var data = args.data;
		var chan = this.normalizeChannelID( data.channel_id );
		var channel = this.channels[chan];
		if (!channel) return this.doSocketError('channel', "Channel not found: " + chan, args);
		
		var username = args.username;
		var user = args.user;
		
		if (!user.privileges.admin && (!channel.users[username] || !channel.users[username].admin)) {
			return this.doSocketError('channel', "You do not have administrator privileges in channel: " + channel.title, args);
		}
		
		var params = {
			session_id: args.socket.metadata.session_id,
			id: data.channel_id,
			topic: data.topic || ''
		};
		
		this.api.invoke( '/api/app/channel_update', params, function(resp) {
			if (!resp.code) {
				// update successful!
				self.logTransaction('topic', "User: " + username + " set topic of channel #" + chan + " to: " + data.topic, data );
				
				// send channel notice
				self.doChannelNotice(chan, {
					username: username,
					label: "Topic",
					content: "<b>" + user.nickname + "</b> changed the topic to: <b>" + data.topic + '</b>'
				});
			}
			else {
				// update error
				self.doSocketError('topic', "Topic update failed: " + resp.description, args);
			}
		} ); // api_channel_update
	},
	
	cmd_emoji: function(args) {
		// add, update or delete custom emoji
		// args.data: { id, title, url }
		var self = this;
		var data = args.data;
		var username = args.username;
		var user = args.user;
		
		if (!user.privileges.admin && !user.privileges.manage_emoji) {
			return this.doSocketError('emoji', "You do not have emoji management privileges.", args);
		}
		
		var uri = '/api/app/emoji_' + data.api;
		delete data.api;
		
		data.session_id = args.socket.metadata.session_id;
		
		this.api.invoke( uri, data, function(resp) {
			if (!resp.code) {
				// emoji action successful!
				self.logTransaction('emoji', "User: " + username + " applied " + uri + " to: " + data.id, data );
			}
			else {
				// emoji error
				self.doSocketError('emoji', "Emoji command failed: " + resp.description, args);
			}
		} ); // api_emoji_
	},
	
	cmd_react: function(args) {
		// react to chat message via emoji
		// args.data: { channel_id, chat_id, seq_id, emoji_id, action }
		var self = this;
		var data = args.data;
		var username = args.username;
		var storage_key = "unbase/records/speech/" + data.seq_id;
		var chat = null;
		
		var chan = this.normalizeChannelID( data.channel_id );
		var channel = this.channels[chan];
		if (!channel) return false; // sanity
		
		// broadcast updated chat reactions to all users in channel
		this.doSocketChannelBroadcast( chan, 'reacted', {
			channel_id: chan,
			id: data.chat_id,
			username: username,
			emoji_id: data.emoji_id,
			action: data.action
		});
		
		if (!this.server.config.get('enable_indexer')) {
			this.logError('react', "Database indexer is disabled, cannot save reaction in storage");
			return;
		}
		if (channel.private) {
			this.logDebug(6, "Cannot save reactions in private channels, skipping");
			return;
		}
		if (channel.pm) {
			this.logDebug(6, "Cannot save reactions in pm channels, skipping");
			return;
		}
		
		this.storage.begin( storage_key, function(err, trans) {
			async.series(
				[
					function(callback) {
						// first, load chat record from DB
						trans.get( storage_key, function(err, data) {
							if (err) {
								self.logError('react', "Cannot find chat record: " + storage_key);
								return callback(err);
							}
							chat = data;
							callback();
						} );
					},
					function(callback) {
						// augment reactions
						if (!chat.reactions) chat.reactions = {};
						var reactions = chat.reactions;
						var action = data.action;
						var emoji_id = data.emoji_id;
						
						if (action == 'add') {
							// add new reaction
							if (!reactions[emoji_id]) {
								reactions[emoji_id] = { users: {}, date: Tools.timeNow() };
								if (emoji_id == "+1") reactions[emoji_id].date = 1; // special case sort for upvote
								else if (emoji_id == "-1") reactions[emoji_id].date = 2; // special case sort for downvote
							}
							
							reactions[emoji_id].users[username] = 1;
							
							// special behavior for +1/-1 emoji: can only vote on one or the other
							if ((emoji_id == "+1") && reactions["-1"] && reactions["-1"].users && reactions["-1"].users[username]) {
								delete reactions["-1"].users[username];
								if (!Tools.numKeys(reactions["-1"].users)) delete reactions["-1"];
							}
							else if ((emoji_id == "-1") && reactions["+1"] && reactions["+1"].users && reactions["+1"].users[username]) {
								delete reactions["+1"].users[username];
								if (!Tools.numKeys(reactions["+1"].users)) delete reactions["+1"];
							}
						}
						else if (action == 'delete') {
							// remove reaction
							if (reactions[emoji_id] && reactions[emoji_id].users && reactions[emoji_id].users[username]) {
								// user has already reacted this emoji on this message, so toggle it back off
								delete reactions[emoji_id].users[username];
								if (!Tools.numKeys(reactions[emoji_id].users)) delete reactions[emoji_id];
							}
						}
						
						// save / broadcast changes
						if (channel.history) {
							// update reactions in channel history cache
							var hist = Tools.findObject( channel.history, { id: data.chat_id } );
							if (hist) hist.reactions = chat.reactions;
						}
						
						// save changes back to storage
						trans.put( storage_key, chat, callback );
					},
					function(callback) {
						// commit transaction
						trans.commit( callback );
					}
				],
				function(err) {
					if (err) {
						self.logError('react', "Cannot react to chat: " + err, args.data);
						trans.abort( function() {
							// rollback complete
							self.logDebug(9, "React rollback complete");
						} );
					}
					else {
						// success
						self.logDebug(9, "Successfully reacted", args.data);
					}
				}
			); // async.series
		} ); // storage.begin
	},
	
	cmd_tags: function(args) {
		// add or remove custom tags on a chat message (i.e. fav_USERNAME)
		// args.data: { channel_id, chat_id, seq_id, action, tags, notify_user }
		// action: add, remove
		var self = this;
		var data = args.data;
		var username = args.username;
		var storage_key = "unbase/records/speech/" + data.seq_id;
		var chat = null;
		
		var chan = this.normalizeChannelID( data.channel_id );
		var channel = this.channels[chan];
		if (!channel) return false; // sanity
		
		// more sanity checks
		if (!data.action) data.action = 'add';
		if (!data.action.match(/^(add|remove)$/)) {
			this.logError('tag', "Unknown tag action: " + data.action);
			return;
		}
		if (!data.tags) {
			this.logError('tag', "No tags specified to update");
			return;
		}
		if (!data.seq_id) {
			this.logError('tag', "No seq_id specified to update");
			return;
		}
		if (!this.server.config.get('enable_indexer')) {
			this.logError('tag', "Database indexer is disabled, cannot update tags in storage");
			return;
		}
		
		this.storage.lock( storage_key, true, function() {
			// exclusive lock acquired
			self.unbase.get( "speech", data.seq_id, function(err, chat) {
				if (err) {
					self.logError('react', "Cannot tag message: " + err, args.data);
					self.storage.unlock( storage_key );
					return;
				}
				
				// update tags
				var chat_tags = self.csvToHash( chat.tags || '' );
				var new_tags = self.csvToHash( data.tags );
				
				if (data.action == 'add') {
					Tools.mergeHashInto( chat_tags, new_tags );
				}
				else if (data.action == 'remove') {
					for (var key in new_tags) delete chat_tags[key];
				}
				
				chat.tags = self.hashKeysToCSV( chat_tags );
				
				if (channel.history) {
					// update reactions in channel history cache
					var hist = Tools.findObject( channel.history, { id: data.chat_id } );
					if (hist) hist.tags = chat.tags;
				}
				
				// update record
				self.unbase.insert( "speech", data.seq_id, chat, function(err) {
					if (err) {
						self.logError('indexer', "Failed to index item: " + err);
						self.storage.unlock( storage_key );
						return;
					}
					self.logDebug(9, "Successfully tagged message", args.data);
					self.storage.unlock( storage_key );
					
					// optionally notify user
					if (data.notify_user) {
						self.doSocketUserBroadcast( username, 'tags_updated', data );
					}
				}); // unbase.insert
			}); // unbase.get
		}); // storage.lock
	},
	
	//
	// Utility Methods:
	//
	
	csvToHash: function(csv) {
		// parse simple CSV into hash keys
		var hash = {};
		if (csv.length) {
			csv.split(/\,\s*/).forEach( function(key) { 
				key = key.trim();
				if (key.match(/\S/)) hash[ key ] = 1; 
			} );
		}
		return hash;
	},
	
	hashKeysToCSV: function(hash) {
		// serialize sorted hash keys to simple CSV
		return Object.keys(hash).sort().join(',');
	}
	
});
