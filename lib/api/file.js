// SpeechBubble API Layer - File
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var cp = require('child_process');
var assert = require("assert");
var Path = require('path');
var os = require('os');
var async = require('async');
var mime = require('mime');
var gm = require('gm').subClass({imageMagick: true});

var Class = require("pixl-class");
var Tools = require("pixl-tools");

module.exports = Class.create({
	
	api_upload_file: function(args, callback) {
		// upload file for user
		var self = this;
		
		if (!args.files['file1']) {
			return self.doError('file', "No file upload data found in request.", callback);
		}
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var temp_file = args.files['file1'].path;
			
			var filename = '';
			if (args.query.webcam) {
				filename = args.query.webcam + '-' + self.getUniqueID('') + '.' + (args.query.ext || 'jpg');
			}
			else {
				filename = Path.basename(args.files['file1'].name).replace(/[^\w\-\.]+/g, '_');
				
				// iOS direct camera upload names the file simply "image.jpg" -- add uniqueness
				if ((args.query.orient || args.query.convert) && (filename.length < 15)) {
					filename = filename.replace(/^(.+)\.(\w+)$/, '$1-' + self.getUniqueID('') + '.$2');
				}
			}
			
			var dargs = Tools.getDateArgs( Tools.timeNow() );
			var storage_key = 'files/' + dargs.yyyy_mm_dd + '/' + filename;
			
			// var url = self.web.getSelfURL( args.request, '/' + storage_key );
			var url = self.server.config.get('base_app_url') + '/' + storage_key;
			
			// optionally process file server-side
			if (filename.match(/\.jpe?g$/i) && args.query.orient) {
				// auto-orient image
				self.orientStoreImage( temp_file, storage_key, function(err) {
					if (err) return self.doError('file', "Failed to process image: " + err, callback);
					callback({ code: 0, url: url });
				} );
			}
			else if (filename.match(/\.mov$/i) && args.query.convert) {
				// convert MOV to MP4
				storage_key = storage_key.replace(/\.mov$/i, '.mp4');
				// url = self.web.getSelfURL( args.request, '/' + storage_key );
				url = self.server.config.get('base_app_url') + '/' + storage_key;
				
				self.convertStoreVideo( temp_file, storage_key, function(err) {
					if (err) return self.doError('file', "Failed to process video: " + err, callback);
					callback({ code: 0, url: url });
				} );
			}
			else {
				// store raw file
				self.storage.putStream( storage_key, fs.createReadStream(temp_file), function(err) {
					if (err) return self.doError('file', "Failed to process uploaded file: " + err, callback);
					callback({ code: 0, url: url });
				} ); // put
			}
		} ); // loaded session
	},
	
	api_file: function(args, callback) {
		// view file for specified user on URI: /files/2018/04/15/myimage.jpg
		var self = this;
		var storage_key = '';
		
		if (args.query.path) {
			storage_key = 'files/' + args.query.path;
		}
		else if (args.request.url.replace(/\?.*$/).match(/files?\/(.+)$/)) {
			storage_key = 'files/' + RegExp.$1;
		}
		else {
			return callback( "400 Bad Request", {}, null );
		}
		
		// if we're using the filesystem, internal redirect to node-static
		// as it handles HTTP 206 partial and byte ranges (i.e. video "streaming")
		if (this.storage.engine.getFilePath) {
			this.storage.head( storage_key, function(err, info) {
				if (err) {
					if (err.code == "NoSuchKey") return callback( false ); // this allows fallback to local filesystem!
					else return callback( "500 Internal Server Error", {}, '' + err );
				}
				
				// internal redirect to static file
				args.internalFile = Path.resolve( self.storage.engine.getFilePath( self.storage.normalizeKey(storage_key) ) );
				self.logDebug(6, "Internal redirect for static response: " + storage_key + ": " + args.internalFile );
				return callback(false);
			} ); // head
			return;
		}
		
		this.storage.getStream( storage_key, function(err, stream) {
			if (err) {
				if (err.code == "NoSuchKey") return callback( false ); // this allows fallback to local filesystem!
				else return callback( "500 Internal Server Error", {}, '' + err );
			}
			
			callback( 
				"200 OK", 
				{
					"Content-Type": mime.getType( Path.basename(storage_key) ),
					"Cache-Control": "max-age: 31536000"
				}, 
				stream 
			);
		} ); // getStream
	},
	
	orientStoreImage: function(source_file, storage_key, callback) {
		// auto-orient image via gm (ImageMagick) and store in storage
		var self = this;
		var fmt = Path.extname( storage_key ).replace(/^\./, '');
		if (!fmt) return callback( new Error("Storage key must have an extension: " + storage_key) );
		
		var temp_file = Path.join( os.tmpdir(), 'sb-image-temp-' + Tools.generateUniqueID() + '.' + fmt );
		this.logDebug(6, "Orienting image: " + source_file );
		
		gm(source_file).autoOrient().write(temp_file, function (err) {
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
	},
	
	convertStoreVideo: function(source_file, storage_key, callback) {
		// convert MOV to MP4 using ffmpeg
		var self = this;
		var fmt = Path.extname( storage_key ).replace(/^\./, '');
		if (!fmt) return callback( new Error("Storage key must have an extension: " + storage_key) );
		
		var temp_file = Path.join( os.tmpdir(), 'sb-video-temp-' + Tools.generateUniqueID() + '.mp4' );
		var cmd = 'ffmpeg -i ' + source_file + ' -vcodec copy -acodec copy ' + temp_file;
		this.logDebug(6, "Converting video: " + cmd );
		
		cp.exec( cmd, function(err, stdout, stderr) {
			if (err) return callback(err);
			self.logDebug(9, "ffmpeg raw output:", '' + stderr);
			
			// apparently it is very difficult to determine if ffmpeg failed by parsing its output or exit code,
			// so we have to just stat() the output file, which MAY EXIST but be zero bytes (sigh).
			fs.stat( temp_file, function(err, stats) {
				if (err || !stats.size) {
					return callback( new Error("Failed to convert video format (ffmpeg died)") );
				}
				
				// store final file
				self.storage.putStream( storage_key, fs.createReadStream(temp_file), function(err) {
					if (err) return callback(err);
					
					// delete temp file, and we're done
					fs.unlink( temp_file, callback );
				} ); // put
			} ); // fs.stat
		} ); // cp.exec
	}
	
} );
