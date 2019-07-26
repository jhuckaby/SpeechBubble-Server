// SpeechBubble API Layer - Channel
// Copyright (c) 2017 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var assert = require("assert");
var Path = require('path');
var os = require('os');
var async = require('async');

var Class = require("pixl-class");
var Tools = require("pixl-tools");

module.exports = Class.create({

	api_channel_create: function(args, callback) {
		// add new channel
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			id: /^\w+$/,
			title: /\S/,
			founder: /^\w+$/
		}, callback)) return;
		
		params.id = this.normalizeChannelID( params.id );
		if (params.id.match(/^pm_/)) return this.doError('channel', "Invalid channel ID: " + params.id);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "create_channels", callback)) return;
			
			var channel = self.channels[ params.id ];
			if (channel) return self.doError('channel', "Channel already exists: " + channel.id, callback);
			
			channel = params;
			channel.enabled = 1;
			channel.created = channel.modified = Tools.timeNow(true);
			
			channel.users = {};
			channel.users[user.username] = { admin: 1 };
			channel.users[channel.founder] = { admin: 1 };
			
			self.logDebug(6, "Creating new channel: " + channel.title, channel);
			
			self.storage.listUnshift( 'global/channels', channel, function(err) {
				if (err) {
					return self.doError('channel', "Failed to create channel: " + err, callback);
				}
				
				self.logDebug(6, "Successfully created channel: " + channel.title, channel);
				self.logTransaction('channel_create', channel.title, self.getClientInfo(args, { channel: channel }));
				
				// store copy in memory
				self.channels[ channel.id ] = channel;
				
				callback({ code: 0, id: channel.id });
				
				// broadcast channel update to all applicable users
				self.broadcastChannelUpdate( channel );
				
			} ); // list insert
		} ); // load session
	},
	
	api_channel_update: function(args, callback) {
		// update existing channel
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;
		
		params.id = this.normalizeChannelID( params.id );
		if (params.id.match(/^pm_/)) return this.doError('channel', "Invalid channel ID: " + params.id, callback);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "edit_channels", callback)) return;
			
			var channel = self.channels[ params.id ];
			if (!channel) return self.doError('channel', "Could not find channel: " + params.id, callback);
			
			if (!user.privileges.admin && (!channel.users[user.username] || !channel.users[user.username].admin)) {
				return self.doError('group', "You do not have administrator privileges in channel: " + channel.title, callback);
			}
			
			params.modified = Tools.timeNow(true);
			
			self.logDebug(6, "Updating channel: " + params.id, params);
			
			self.storage.listFindUpdate( 'global/channels', { id: params.id }, params, function(err) {
				if (err) {
					return self.doError('group', "Failed to update channel: " + err, callback);
				}
				
				// update copy in memory
				Tools.mergeHashInto( channel, params );
				
				self.logDebug(6, "Successfully updated channel: " + channel.title, channel);
				self.logTransaction('channel_update', channel.title, self.getClientInfo(args, { channel: channel }));
				
				callback({ code: 0 });
				
				if (params.private && channel.live_users) {
					// channel became private
					// make sure all users are meant to be here
					for (var username in channel.live_users) {
						if (!channel.users[username]) {
							self.userLeaveChannel( username, channel.id, "private" );
						}
					}
				}
				
				// broadcast channel update to all applicable users
				self.broadcastChannelUpdate( channel );
				
			} ); // listFindUpdate
		} ); // loadSession
	},
	
	api_channel_delete: function(args, callback) {
		// delete existing channel
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;
		
		params.id = this.normalizeChannelID( params.id );
		if (params.id.match(/^pm_/)) return this.doError('channel', "Invalid channel ID: " + params.id);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "delete_channels", callback)) return;
			
			var channel = self.channels[ params.id ];
			if (!channel) return self.doError('channel', "Could not find channel: " + params.id, callback);
			
			// if any users are left in channel, kick them out
			if (channel.live_users) {
				for (var username in channel.live_users) {
					self.userLeaveChannel( username, channel.id, "delete" );
				}
			}
			
			if (!user.privileges.admin && (!channel.users[user.username] || !channel.users[user.username].admin)) {
				return self.doError('group', "You do not have administrator privileges in channel: " + channel.title, callback);
			}
			
			self.logDebug(6, "Deleting channel: " + params.id);
			
			self.storage.listFindDelete( 'global/channels', { id: params.id }, function(err) {
				if (err) {
					return self.doError('group', "Failed to delete channel: " + err, callback);
				}
				
				// delete copy in memory
				delete self.channels[ channel.id ];
				
				self.logDebug(6, "Successfully deleted channel: " + channel.title, channel);
				self.logTransaction('channel_delete', channel.title, self.getClientInfo(args, { channel: channel }));
				
				callback({ code: 0 });
				
				// broadcast channel update to all applicable users
				self.broadcastChannelUpdate( { id: channel.id, deleted: 1 } );
				
			} ); // listFindDelete (channel)
		} ); // load session
	},
	
	api_channel_get: function(args, callback) {
		// fetch single channel (for editing)
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;
			
		if (params.id.match(/^pm_/)) return this.doError('channel', "Invalid channel ID: " + params.id);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var channel = self.channels[ params.id ];
			if (!channel) return self.doError('channel', "Could not find channel: " + params.id, callback);
			
			// make sure user has access to channel
			if (!user.privileges.admin && channel.private && !channel.users[user.username]) {
				// vague error message, so user doesn't even know if channel exists or not
				return self.doError('channel', "Could not find channel: " + params.id, callback);
			}
			
			callback({ 
				code: 0, 
				channel: Tools.copyHashRemoveKeys(channel, { history: 1 })
			});
			
		}); // loadSession
	},
	
	api_channel_get_all: function(args, callback) {
		// get list of channels (with pagination)
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var sorted_chans = Tools.hashKeysToArray( self.channels ).filter( function(chan) {
				return !self.channels[chan].pm;
			} ).sort();
			var total_length = sorted_chans.length;
			var chan_page = sorted_chans.splice( params.offset || 0, params.limit || sorted_chans.length );
			
			var channels = [];
			chan_page.forEach( function(chan) {
				// make sure user has access to each channel
				var channel = Tools.copyHashRemoveKeys( self.channels[chan], { history: 1 } );
				if (user.privileges.admin || !channel.private || channel.users[user.username]) {
					channels.push( channel );
				}
			} );
			
			callback({ 
				code: 0, 
				list: { length: total_length },
				rows: channels 
			});
		} ); // loaded session
	},
	
	api_channel_get_users: function(args, callback) {
		// get channel and info about some or all of its users
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			channel: /^\w+$/
		}, callback)) return;
			
		params.channel = this.normalizeChannelID( params.channel );
		if (params.channel.match(/^pm_/)) return this.doError('channel', "Invalid channel ID: " + params.channel);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var channel = self.channels[ params.channel ];
			if (!channel) return self.doError('channel', "Could not find channel: " + params.channel, callback);
			
			// make sure user has access to channel
			if (!user.privileges.admin && channel.private && !channel.users[user.username]) {
				// vague error message, so user doesn't even know if channel exists or not
				return self.doError('channel', "Could not find channel: " + params.channel, callback);
			}
			
			// gather all registered and online users
			// sort and paginate
			var usernames = Tools.copyHash( channel.users || {}, true );
			if (params.filter == 'online') {
				var live_users = channel.live_users || {};
				for (var key in usernames) {
					if (!(key in live_users)) delete usernames[key];
				}
			}
			
			var sorted_usernames = Tools.hashKeysToArray( usernames ).sort();
			var total_length = sorted_usernames.length;
			var username_page = sorted_usernames.splice( params.offset || 0, params.limit || sorted_usernames.length );
			
			var channel_users = [];
			username_page.forEach( function(username) {
				var user = Tools.copyHashRemoveKeys( self.users[username], { sockets: 1, password: 1, salt: 1 } );
				Tools.mergeHashInto( user, channel.users[username] || {} ); // adds 'admin' (or not)
				if (channel.live_users) Tools.mergeHashInto( user, channel.live_users[username] || {} ); // adds 'live'
				channel_users.push( user );
			} );
			
			callback({ 
				code: 0, 
				channel: Tools.copyHashRemoveKeys(channel, { history: 1 }), 
				list: { length: total_length },
				rows: channel_users 
			});
		}); // loadSession
	},
	
	api_channel_add_user: function(args, callback) {
		// add user to channel
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			channel: /^\w+$/,
			username: /^\w+$/
		}, callback)) return;
		
		params.username = this.normalizeUsername( params.username );
		params.channel = this.normalizeChannelID( params.channel );
		if (params.channel.match(/^pm_/)) return this.doError('channel', "Invalid channel ID: " + params.channel);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "edit_channels", callback)) return;
			
			var channel = self.channels[ params.channel ];
			if (!channel) return self.doError('channel', "Could not find channel: " + params.channel, callback);
		
			if (!user.privileges.admin && (!channel.users[user.username] || !channel.users[user.username].admin)) {
				return self.doError('channel', "You do not have administrator privileges in channel: " + channel.title, callback);
			}
			
			if (channel.users[ params.username ]) {
				return self.doError('channel', "User '"+params.username+"' is already a member of channel: " + channel.title, callback);
			}
			
			self.logDebug(6, "Adding user: " + params.username + " to channel: " + params.channel, params);
			
			channel.users[ params.username ] = {};
			var updates = { users: channel.users };
			
			self.storage.listFindUpdate( 'global/channels', { id: params.channel }, updates, function(err, channel) {
				if (err) {
					return self.doError('group', "Failed to update channel: " + err, callback);
				}
				
				self.logDebug(6, "Successfully updated channel: " + channel.title, channel);
				self.logTransaction('channel_add_user', channel.title, self.getClientInfo(args, params));
				
				callback({ code: 0 });
				
				// broadcast channel update to all applicable users
				self.broadcastChannelUpdate( channel );
				
			} ); // listFindUpdate
		} ); // loadSession
	},
	
	api_channel_delete_user: function(args, callback) {
		// remove user from channel
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			channel: /^\w+$/,
			username: /^\w+$/
		}, callback)) return;
		
		params.username = this.normalizeUsername( params.username );
		params.channel = this.normalizeChannelID( params.channel );
		if (params.channel.match(/^pm_/)) return this.doError('channel', "Invalid channel ID: " + params.channel);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "edit_channels", callback)) return;
			
			var channel = self.channels[ params.channel ];
			if (!channel) return self.doError('channel', "Could not find channel: " + params.channel, callback);
		
			if (!user.privileges.admin && (!channel.users[user.username] || !channel.users[user.username].admin)) {
				return self.doError('channel', "You do not have administrator privileges in channel: " + channel.title, callback);
			}
			
			if (!channel.users[ params.username ]) {
				return self.doError('channel', "User '"+params.username+"' is not a member of channel: " + channel.title, callback);
			}
			
			self.logDebug(6, "Removing user: " + params.username + " from channel: " + params.channel, params);
			
			delete channel.users[ params.username ];
			var updates = { users: channel.users };
			
			self.storage.listFindUpdate( 'global/channels', { id: params.channel }, updates, function(err) {
				if (err) {
					return self.doError('group', "Failed to update channel: " + err, callback);
				}
				
				self.logDebug(6, "Successfully updated channel: " + channel.title, channel);
				self.logTransaction('channel_delete_user', channel.title, self.getClientInfo(args, params));
				
				callback({ code: 0 });
				
				// if private channel and user is live, kick user
				if (channel.private && channel.live_users && channel.live_users[params.username]) {
					self.userLeaveChannel( params.username, channel.id, "private" );
				}
				
				// broadcast channel update to all applicable users
				self.broadcastChannelUpdate( channel );
				
			} ); // listFindUpdate
		} ); // loadSession
	},
	
	api_channel_modify_user: function(args, callback) {
		// modify user in channel (i.e. grant admin)
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			channel: /^\w+$/,
			username: /^\w+$/
		}, callback)) return;
		
		params.username = this.normalizeUsername( params.username );
		params.channel = this.normalizeChannelID( params.channel );
		if (params.channel.match(/^pm_/)) return this.doError('channel', "Invalid channel ID: " + params.channel);
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "edit_channels", callback)) return;
			
			var channel = self.channels[ params.channel ];
			if (!channel) return self.doError('channel', "Could not find channel: " + params.channel, callback);
		
			if (!user.privileges.admin && (!channel.users[user.username] || !channel.users[user.username].admin)) {
				return self.doError('channel', "You do not have administrator privileges in channel: " + channel.title, callback);
			}
			
			if (!channel.users[ params.username ]) {
				return self.doError('channel', "User '"+params.username+"' is not a member of channel: " + channel.title, callback);
			}
			
			var user_mods = Tools.copyHashRemoveKeys( params, { channel: 1, username: 1 } );
			
			self.logDebug(6, "Modifying user: " + params.username + " in channel: " + params.channel, params);
			
			Tools.mergeHashInto( channel.users[ params.username ], user_mods );
			var updates = { users: channel.users };
			
			self.storage.listFindUpdate( 'global/channels', { id: params.channel }, updates, function(err, channel) {
				if (err) {
					return self.doError('group', "Failed to update channel: " + err, callback);
				}
				
				self.logDebug(6, "Successfully updated channel: " + channel.title, channel);
				self.logTransaction('channel_modify_user', channel.title, self.getClientInfo(args, params));
				
				callback({ code: 0 });
				
				// broadcast channel update to all applicable users
				self.broadcastChannelUpdate( channel );
				
			} ); // listFindUpdate
		} ); // loadSession
	}
	
});
