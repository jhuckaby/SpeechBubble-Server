// SpeechBubble API Layer - Emoji
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var assert = require("assert");
var Path = require('path');
var os = require('os');
var async = require('async');
var gm = require('gm').subClass({imageMagick: true});

var Class = require("pixl-class");
var Tools = require("pixl-tools");
var PixlRequest = require("pixl-request");

module.exports = Class.create({

	api_emoji_create: function(args, callback) {
		// add new emoji
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			id: /^[\w\-\+]+$/,
			title: /\S/
		}, callback)) return;
		
		params.id = params.id.toLowerCase();
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "manage_emoji", callback)) return;
			
			var emoji = self.emoji[ params.id ];
			if (emoji) return self.doError('emoji', "Emoji already exists: " + emoji.id, callback);
			
			emoji = params;
			emoji.enabled = 1;
			emoji.created = emoji.modified = Tools.timeNow(true);
			emoji.username = user.username;
			
			self.logDebug(6, "Creating new emoji: " + emoji.id, emoji);
			
			self.processRemoteEmojiMedia( emoji, function(err) {
				if (err) {
					return self.doError('emoji', "Failed to create emoji: " + err, callback);
				}
				
				if (!emoji.format) {
					return self.doError('emoji', "Failed to create emoji: No image format specified", callback);
				}
				
				self.storage.listUnshift( 'global/emoji', emoji, function(err) {
					if (err) {
						return self.doError('emoji', "Failed to create emoji: " + err, callback);
					}
					
					self.logDebug(6, "Successfully created emoji: " + emoji.id, emoji);
					self.logTransaction('emoji_create', emoji.id, self.getClientInfo(args, { emoji: emoji }));
					
					// store copy in memory
					self.emoji[ emoji.id ] = emoji;
					
					callback({ code: 0, id: emoji.id });
					
					// broadcast emoji update to all users
					self.doSocketBroadcastAll( 'emoji_created', emoji );
					
				} ); // list insert
			} ); // remote media
		} ); // load session
	},
	
	api_emoji_update: function(args, callback) {
		// update existing emoji
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			id: /^[\w\-\+]+$/
		}, callback)) return;
		
		params.id = params.id.toLowerCase();
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "manage_emoji", callback)) return;
			
			var emoji = self.emoji[ params.id ];
			if (!emoji) return self.doError('emoji', "Could not find emoji: " + params.id, callback);
			
			params.modified = Tools.timeNow(true);
			
			self.logDebug(6, "Updating emoji: " + params.id, params);
			
			// delete emoji sound if `delete_sound` is set
			// and remove delete_sound from params
			if (params.delete_sound) {
				try { fs.unlinkSync( 'htdocs/sounds/emoji/' + params.id + '.mp3' ); } catch(e) {;}
				delete params.delete_sound;
				params.sound = 0;
			}
			
			self.processRemoteEmojiMedia( emoji, function(err) {
				if (err) {
					return self.doError('emoji', "Failed to create emoji: " + err, callback);
				}
				
				self.storage.listFindUpdate( 'global/emoji', { id: params.id }, params, function(err) {
					if (err) {
						return self.doError('group', "Failed to update emoji: " + err, callback);
					}
					
					// update copy in memory
					Tools.mergeHashInto( emoji, params );
					
					self.logDebug(6, "Successfully updated emoji: " + emoji.id, emoji);
					self.logTransaction('emoji_update', emoji.id, self.getClientInfo(args, { emoji: emoji }));
					
					callback({ code: 0 });
					
					// broadcast emoji update to all users
					self.doSocketBroadcastAll( 'emoji_updated', emoji );
					
				} ); // listFindUpdate
			} ); // remote media
		} ); // loadSession
	},
	
	api_emoji_delete: function(args, callback) {
		// delete existing emoji
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			id: /^[\w\-\+]+$/
		}, callback)) return;
		
		params.id = params.id.toLowerCase();
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "manage_emoji", callback)) return;
			
			var emoji = self.emoji[ params.id ];
			if (!emoji) return self.doError('emoji', "Could not find emoji: " + params.id, callback);
			
			self.logDebug(6, "Deleting emoji: " + params.id);
			
			// delete files first
			try { fs.unlinkSync( 'htdocs/images/emoji/' + params.id + '.' + emoji.format ); } catch(e) {;}
			if (emoji.sound) {
				try { fs.unlinkSync( 'htdocs/sounds/emoji/' + params.id + '.mp3' ); } catch(e) {;}
			}
			
			// delete from storage
			self.storage.listFindDelete( 'global/emoji', { id: params.id }, function(err) {
				if (err) {
					return self.doError('group', "Failed to delete emoji: " + err, callback);
				}
				
				// delete copy in memory
				delete self.emoji[ emoji.id ];
				
				self.logDebug(6, "Successfully deleted emoji: " + emoji.id, emoji);
				self.logTransaction('emoji_delete', emoji.id, self.getClientInfo(args, { emoji: emoji }));
				
				callback({ code: 0 });
				
				// broadcast emoji update to all users
				self.doSocketBroadcastAll( 'emoji_deleted', emoji );
				
			} ); // listFindDelete (emoji)
		} ); // load session
	},
	
	api_emoji_get: function(args, callback) {
		// fetch single emoji (for editing)
		var self = this;
		var params = args.params;
		
		if (!this.requireParams(params, {
			id: /^[\w\-\+]+$/
		}, callback)) return;
		
		params.id = params.id.toLowerCase();
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var emoji = self.emoji[ params.id ];
			if (!emoji) return self.doError('emoji', "Could not find emoji: " + params.id, callback);
			
			callback({ 
				code: 0, 
				emoji: emoji
			});
			
		}); // loadSession
	},
	
	api_emoji_get_all: function(args, callback) {
		// get list of emoji (with pagination)
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var sorted_emoji = Tools.hashKeysToArray( self.emoji ).sort();
			var list_length = sorted_emoji.length;
			var emoji_page = sorted_emoji.splice( params.offset || 0, params.limit || sorted_emoji.length );
			var rows = emoji_page.map( function(id) { return self.emoji[id]; } );
			
			callback({ 
				code: 0,
				list: { length: list_length },
				rows: rows
			});
		} ); // loaded session
	},
	
	api_emoji_upload: function(args, callback) {
		// upload emoji image and/or sound
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		
		if (!this.requireParams(params, {
			id: /^[\w\-\+]+$/
		}, callback)) return;
		
		if (!args.files['file1']) {
			return self.doError('emoji', "No file upload data found in request.", callback);
		}
		
		params.id = params.id.toLowerCase();
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "manage_emoji", callback)) return;
			
			async.eachOfSeries( args.files,
				function(file, key, callback) {
					// process single file
					self.logDebug(6, "Processing uploaded file: " + key + " for emoji: " + params.id, file);
					var mime = file.type || '';
					
					if (mime.match(/image/)) {
						// resize image and save
						var fmt = params.image_format || 'png';
						var dest_file = 'htdocs/images/emoji/' + params.id + '.' + fmt;
						gm(file.path).resize(64, 64).write(dest_file, function (err) {
							if (err) {
								// ImageMagick errors can be quite verbose.
								// Log everything, but only return first line in error message.
								var err_msg = err.toString().trim();
								self.logError('imagemagick', err_msg);
								return callback( new Error( err_msg.split(/\n/).shift() ) );
							}
							self.logDebug(6, "Wrote image file: " + dest_file);
							callback();
						}); // gm
					}
					else if (mime.match(/audio/)) {
						// save sound in correct folder
						// sounds are ALWAYS in mp3 format (all patents expired!  YAY!)
						var dest_file = 'htdocs/sounds/emoji/' + params.id + '.mp3';
						
						var inp = fs.createReadStream(file.path);
						var outp = fs.createWriteStream(dest_file);
						inp.on('end', function(err) {
							if (err) return callback( new Error("Failed to write file: " + dest_file + ": " + err) );
							else callback();
						} );
						inp.pipe( outp );
					}
					else {
						return callback( new Error("Unknown file type: " + mime) );
					}
				},
				function(err) {
					if (err) {
						return self.doError('emoji', "Failed to process emoji file: " + params.id + ": " + err, callback);
					}
					
					self.logDebug(6, "All emoji files written successfully");
					callback({ code: 0 });
				}
			); // eachOfSeries
		} ); // loadSession
	},
	
	processRemoteEmojiMedia: function(emoji, callback) {
		// fetch, resize and store emoji image from custom source URL
		var self = this;
		var request = new PixlRequest( 'SpeechBubble Chat ' + this.server.__version );
		request.setFollow( 32 );
		
		var urls = emoji.urls || [];
		if (emoji.url) urls.push( emoji.url );
		if (!urls.length) return callback();
		
		urls.splice(2); // 2 urls max (1 image and 1 sound)
		
		delete emoji.url;
		delete emoji.urls;
		
		async.each( urls,
			function(url, callback) {
				var temp_file = Path.join( os.tmpdir(), "sb-upload-temp-" + Tools.generateShortID() + '.bin' );
				self.logDebug(6, "Fetching Emoji URL: " + url, { temp_file: temp_file } );
				
				request.get( url, { download: temp_file }, function(err, resp) {
					// check for http error code
					if (resp && resp.statusCode && resp.statusCode.toString && !resp.statusCode.toString().match(request.successMatch)) {
						err = new Error( "HTTP " + resp.statusCode + " " + resp.statusMessage );
						err.code = resp.statusCode;
					}
					if (err) {
						try { fs.unlinkSync( temp_file ); } catch(e) {;}
						return callback(err);
					}
					
					// guess format based on file ext or content type
					var fmt = '';
					if (url.match(/\.(\w+)(\?|$)/)) {
						fmt = RegExp.$1.toLowerCase();
					}
					else if (resp.headers['content-type'] && resp.headers['content-type'].match(/^(image|audio)\/(\w+)$/i)) {
						fmt = RegExp.$2.toLowerCase().replace(/jpeg/, 'jpg').replace(/mpeg/, 'mp3');
					}
					
					if (fmt.match(/^(png|gif|jpg)$/)) {
						// process image
						
						// set the format, which should be saved in the caller
						emoji.format = fmt;
						
						// first rename so imagemagick likes it
						var im_temp_file = temp_file.replace(/\.bin$/, '.' + fmt);
						fs.renameSync( temp_file, im_temp_file );
						
						var dest_file = 'htdocs/images/emoji/' + emoji.id + '.' + fmt;
						gm(im_temp_file).resize(64, 64).write(dest_file, function (err) {
							fs.unlinkSync( im_temp_file );
							if (err) {
								// ImageMagick errors can be quite verbose.
								// Log everything, but only return first line in error message.
								var err_msg = err.toString().trim();
								self.logError('imagemagick', err_msg);
								return callback( new Error( err_msg.split(/\n/).shift() ) );
							}
							self.logDebug(6, "Wrote image file: " + dest_file);
							callback();
						}); // gm
					}
					else if (fmt.match(/^(mp3)$/)) {
						// process audio, just move into place
						var dest_file = 'htdocs/sounds/emoji/' + emoji.id + '.mp3';
						
						var inp = fs.createReadStream(temp_file);
						var outp = fs.createWriteStream(dest_file);
						inp.on('end', function(err) {
							try { fs.unlinkSync( temp_file ); } catch(e) {;}
							if (err) return callback( new Error("Failed to write file: " + dest_file + ": " + err) );
							else callback();
						} );
						inp.pipe( outp );
					}
					else return callback( new Error("Unsupported file format: " + fmt) );
					
				} ); // get
			},
			callback
		);
	}
	
});
