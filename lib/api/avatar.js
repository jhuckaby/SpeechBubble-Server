// SpeechBubble API Layer - Avatar
// Copyright (c) 2017 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var assert = require("assert");
var Path = require('path');
var os = require('os');
var async = require('async');
var gm = require('gm').subClass({imageMagick: true});

var Class = require("pixl-class");
var Tools = require("pixl-tools");

module.exports = Class.create({
	
	api_upload_avatar: function(args, callback) {
		// upload avatar for user
		var self = this;
		
		if (!args.files['file1']) {
			return self.doError('avatar', "No file upload data found in request.", callback);
		}
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var temp_file = args.files['file1'].path;
			var base_path = '/users/' + user.username + '/avatar';
			
			var sizes = [256, 64];
			
			async.eachSeries( sizes,
				function(size, callback) {
					self.resizeStoreImage( temp_file, size, size, base_path + '/' + size + '.png', callback );
				},
				function(err) {
					// all done with all image sizes
					if (err) return self.doError('avatar', err.toString(), callback);
					
					// update user to bump mod date (for cache bust on avatar)
					user.modified = Tools.timeNow(true);
					user.custom_avatar = Tools.timeNow(true);
					
					self.logDebug(6, "Updating user", user);
					
					self.storage.put( "users/" + self.normalizeUsername(user.username), user, function(err, data) {
						if (err) {
							return self.doError('user', "Failed to update user: " + err, callback);
						}
						
						self.logDebug(6, "Successfully updated user");
						self.logTransaction('user_update', user.username, 
							self.getClientInfo(args, { user: Tools.copyHashRemoveKeys( user, { password: 1, salt: 1 } ) }));
						
						callback({ code: 0 });
						
						// broadcast change to all channels
						self.afterUserChange( 'avatar_change', { session: session, user: user } );
					} ); // storage.put
				} // done with images
			); // eachSeries
		} ); // loaded session
	},
	
	api_admin_upload_avatar: function(args, callback) {
		// admin only: upload avatar for any user
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		
		if (!args.files['file1']) {
			return self.doError('avatar', "No file upload data found in request.", callback);
		}
		
		if (!this.requireParams(params, {
			username: /^[\w\-\.]+$/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, admin_user) {
			if (!session) {
				return self.doError('session', "Session has expired or is invalid.", callback);
			}
			if (!admin_user) {
				return self.doError('user', "User not found: " + session.username, callback);
			}
			if (!admin_user.active) {
				return self.doError('user', "User account is disabled: " + session.username, callback);
			}
			if (!admin_user.privileges.admin) {
				return self.doError('user', "User is not an administrator: " + session.username, callback);
			}
			
			self.loadUser( params.username, function(err, user) {
				if (err) {
					return self.doError('user', "User not found: " + params.username, callback);
				}
				
				var temp_file = args.files['file1'].path;
				var base_path = '/users/' + params.username + '/avatar';
				var sizes = [256, 64];
				
				async.eachSeries( sizes,
					function(size, callback) {
						self.resizeStoreImage( temp_file, size, size, base_path + '/' + size + '.png', callback );
					},
					function(err) {
						// all done with all image sizes
						if (err) return self.doError('avatar', err.toString(), callback);
						
						// update user to bump mod date (for cache bust on avatar)
						user.modified = Tools.timeNow(true);
						user.custom_avatar = Tools.timeNow(true);
						
						self.logDebug(6, "Updating user", user);
						
						self.storage.put( "users/" + self.normalizeUsername(params.username), user, function(err, data) {
							if (err) {
								return self.doError('user', "Failed to update user: " + err, callback);
							}
							
							self.logDebug(6, "Successfully updated user");
							self.logTransaction('user_update', user.username, 
								self.getClientInfo(args, { user: Tools.copyHashRemoveKeys( user, { password: 1, salt: 1 } ) }));
							
							callback({ code: 0 });
							
							// broadcast change to all channels
							self.afterUserChange( 'avatar_change', { session: session, user: user } );
						} ); // storage.put
					} // done with images
				); // eachSeries
			} ); // loadUser
		} ); // loaded session
	},
	
	api_delete_avatar: function(args, callback) {
		// delete avatar for user
		var self = this;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var base_path = '/users/' + user.username + '/avatar';
			var sizes = [256, 64];
			
			async.eachSeries( sizes,
				function(size, callback) {
					self.storage.delete( base_path + '/' + size + '.png', callback );
				},
				function(err) {
					// all done with all image sizes
					if (err) return self.doError('avatar', err.toString(), callback);
					
					// update user to bump mod date (for cache bust on avatar)
					user.modified = Tools.timeNow(true);
					delete user.custom_avatar;
					
					self.logDebug(6, "Updating user", user);
					
					self.storage.put( "users/" + self.normalizeUsername(user.username), user, function(err, data) {
						if (err) {
							return self.doError('user', "Failed to update user: " + err, callback);
						}
						
						self.logDebug(6, "Successfully updated user");
						self.logTransaction('user_update', user.username, 
							self.getClientInfo(args, { user: Tools.copyHashRemoveKeys( user, { password: 1, salt: 1 } ) }));
						
						callback({ code: 0 });
						
						// broadcast change to all channels
						self.afterUserChange( 'avatar_change', { session: session, user: user } );
					} ); // storage.put
				} // done with images
			); // eachSeries
		} ); // loaded session
	},
	
	api_avatar: function(args, callback) {
		// view avatar for specified user on URI: /api/app/avatar/USERNAME.png
		var self = this;
		var size = parseInt( args.query.size || 256 );
		
		// currently supporting 64px and 256px sizes
		if (size > 64) size = 256;
		else size = 64;
		
		if (!args.request.url.match(/\/avatar\/(\w+)\.\w+(\?|$)/)) {
			return self.doError('avatar', "Invalid URL format", callback);
		}
		var username = RegExp.$1;
		var storage_key = '/users/' + username + '/avatar/' + size + '.png';
		
		this.storage.getStream( storage_key, function(err, stream) {
			if (err) {
				// use default avatar image instead
				stream = fs.createReadStream('htdocs/images/default.png');
			}
			
			callback( 
				"200 OK", 
				{
					"Content-Type": "image/png",
					"Cache-Control": "max-age: 31536000"
				}, 
				stream 
			);
		} ); // getStream
	},
	
	api_override_avatar: function(args, callback) {
		// override avatar for user
		// (upload temporary replacement image, swapped client-side per app instance)
		var self = this;
		
		if (!args.files['file1']) {
			return self.doError('avatar', "No file upload data found in request.", callback);
		}
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var temp_file = args.files['file1'].path;
			var filename = 'avatar-' + self.getUniqueID('') + '.png';
			var dargs = Tools.getDateArgs( Tools.timeNow() );
			var storage_key = 'files/' + dargs.yyyy_mm_dd + '/' + filename;
			var url = self.server.config.get('base_app_url') + '/' + storage_key;
			
			self.resizeStoreImage( temp_file, 128, 128, storage_key, function(err) {
				// all done with image transform
				if (err) return self.doError('avatar', err.toString(), callback);
				
				callback({ code: 0, url: url });
			} ); // resizeStoreImage
		} ); // loaded session
	},
	
	resizeStoreImage: function(source_file, width, height, storage_key, callback) {
		// resize image to fit via gm (ImageMagick) and store in storage
		var self = this;
		var fmt = Path.extname( storage_key ).replace(/^\./, '');
		if (!fmt) return callback( new Error("Storage key must have an extension: " + storage_key) );
		
		var temp_file = Path.join( os.tmpdir(), 'sb-image-temp-' + Tools.generateUniqueID() + '.' + fmt );
		this.logDebug(6, "Resizing image: " + source_file + " to " + width + "x" + height );
		
		gm(source_file).resize(width, height).write(temp_file, function (err) {
			if (err) {
				// ImageMagick errors can be quite verbose.
				// Log everything, but only return first line in error message.
				var err_msg = err.toString().trim();
				self.logError('imagemagick', err_msg);
				return callback( new Error( err_msg.split(/\n/).shift() ) );
			}
			
			// store final file
			self.storage.putStream( storage_key, fs.createReadStream(temp_file), function(err) {
				if (err) return callback(err);
				
				// delete temp file, and we're done
				fs.unlink( temp_file, callback );
			} ); // put
		}); // gm
	}
	
} );
