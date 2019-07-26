#!/usr/bin/env node

// Backfill indexer from IRC logs
// Usage: gzip -cd /opt/simpleirc/logs/archive/transcript/2013/08/*.log.gz | /opt/speechbubble/bin/irc-backfill.js --dryrun

// Note: This MUST be back-filled in order, due to timeline list push.  
// Cannot back-fill from present day backwards.

var nick_map = {
	joe: "jhuckaby",
	joseph: "jhuckaby",
	tory: "tblue",
	bob: "rdominy",
	robert: "rdominy",
	fish: "afineshriber",
	aaron: "afineshriber",
	lauren: "lhaven",
	mary: "mpawlowski",
	riya: "rverghese",
	dylan: "dalbrecht",
	albrechtd: "dalbrecht"
};

var Path = require('path');
var cp = require('child_process');
var os = require('os');
var fs = require('fs');
var readline = require('readline');
var async = require('async');

var cli = require('pixl-cli');
cli.global();

var Tools = require('pixl-tools');
var PixlServer = require('pixl-server');

// chdir to the proper server root dir
process.chdir( Path.dirname( __dirname ) );

// load app's config file
var config = require('../conf/config.json');

config.debug = true;
config.debug_level = 1;
// config.echo = true;
config.color = true;

config.Storage.transactions = false;
config.Storage.log_event_types = { 
	'index':1, 'unindex':1, 'search':1, 'sort':1
};

var server = new PixlServer({
	
	__name: 'SpeechBackfill',
	__version: "1.0",
	
	config: config,
	
	components: [
		require('pixl-server-storage'),
		require('pixl-server-unbase')
	]
});

var app = {
	
	stats: {
		total_inserted: 0
	},
	
	_uniqueIDCounter: 0,
	getShortID: function(prefix) {
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
	
	indexChatMessage: function(data, callback) {
		// index chat in unbase, and timeline
		var self = this;
		data.seq_id = this.getShortID('');
		
		// add hour code for unbase
		var dargs = Tools.getDateArgs( data.date );
		var timejump_path = "timejump/" + data.channel_id + "/" + dargs.yyyy_mm_dd;
		var hour_code = 'h' + dargs.hh;
		
		var timeline_path = "timeline/" + data.channel_id;
		var opts = { page_size: 1000 };
		
		this.storage.listPush( timeline_path, { seq_id: data.seq_id }, opts, function(err, list) {
			if (err) {
				die("Failed to add item to timeline: " + err + "\n");
				return;
			}
			
			// cross-ref timeline and unbase record
			data.timeline_idx = list.length - 1;
			
			self.unbase.insert( "speech", data.seq_id, data, function(err) {
				if (err) {
					die("Failed to index item: " + err + "\n");
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
									die("Failed to add stub to timejump hash: " + err + "\n");
								}
								self.storage.unlock( timejump_path );
								callback();
							} ); // hashPut
						}
						else {
							// hour code already set, we're done
							self.storage.unlock( timejump_path );
							callback();
						}
					} ); // hashGetAll
				} ); // lock
			} ); // unbase.insert
		} ); // listPush
	},
	
	run: function() {
		var self = this;
		this.__name = server.__name;
		this.logger = server.logger;
		
		var storage = this.storage = server.Storage;
		var unbase = this.unbase = server.Unbase;
		
		// storage system is ready to go
		print("\nServer has started up\n");
		
		var queue = async.queue( function(data, callback) {
			// console.log( data );
			print("LINE: " + data.line + "\n");
			delete data.line;
			
			// fix weird ACTION binary ASCII 001 garbage
			data.content = data.content.replace( /[\x01]/g, '' ).trim();
			
			// map old hostname over, for links
			data.content = data.content.replace(/\birc\.admission\.net\b/g, "admission.speech.im");
			
			data.id = Tools.generateUniqueID(32, data.username);
			data.username = data.username.toLowerCase().replace(/_+$/, '').replace(/notify$/, '');
			if (nick_map[data.username]) data.username = nick_map[data.username];
			
			if (data.content.match(/^ACTION\s+(.+)$/)) {
				data.content = RegExp.$1;
				data.type = 'pose';
			}
			else if (data.content.match(/^\s*(\{|<|\[)[\s\S]*(\}|\]|>)\s*$/)) {
				// auto-detect JSON or XML
				data.type = 'code';
			}
			
			// auto-detect snapshots and uploads
			if (data.content.match(/\[snapshot\]/)) {
				data.content = data.content.replace(/\[snapshot\]/, '');
				data.tags = 'snapshot';
			}
			else if (data.content.match(/^Upload\:\s+https?\:\/\/admission\./)) {
				data.tags = 'upload';
			}
			
			if (cli.args.dryrun) {
				print( JSON.stringify(data, null, "\t") + "\n" );
				process.nextTick( callback );
			}
			else {
				self.indexChatMessage(data, function() {
					self.stats.total_inserted++;
					callback();
				});
			}
		}, 1 );
		
		queue.drain = function() {
			print("RECEIVED QUEUE DRAIN\n");
			
			// show total record count
			self.storage.get( "unbase/index/speech/_id", function(err, data) {
				if (err) {
					data = { length: 0 };
				}
				
				print("\n");
				print("Records Inserted:    " + Tools.commify(self.stats.total_inserted) + "\n");
				print("Total Records in DB: " + Tools.commify(data.length) + "\n" );
				print("\n");
				
				server.shutdown();
			} ); // get
		};
		
		// this.queue.length()
		
		var last_row = null;
		
		var rl = readline.createInterface({
			input: process.stdin
		});
		
		rl.on('line', function(line) {
			// print("LINE: " + line + "\n");
			// [1528387461.17986][2018-06-07 09:04:21][32752][transcript][52.9.218.218][mary] PRIVMSG #ops :!kick riya_
			// [1545271280.70359][2018-12-19 18:01:20][15739][transcript][52.9.218.218][Joe[dinner]] PRIVMSG #ops :haha
			// [1545241032.42073][2018-12-19 09:37:12][15739][transcript][127.0.0.1][PerformaNotify!~PerformaNotify@irc.admission.net] PRIVMSG #performa Performa Dev Alert Cleared: dash01.dev.ca: High CPU Load
			
			if (line.match(/\[([\d\.]+)\]\[([\d\-\s\:]+)\]\[(\d+)\]\[transcript\]\[([\d\.]+)\]\[(\w+).+?\s+PRIVMSG\s+\#(\w+)\s+(.+)$/)) {
				var row = {
					line: line,
					type: 'standard',
					date: parseFloat( RegExp.$1 ),
					username: RegExp.$5,
					channel_id: RegExp.$6,
					content: RegExp.$7
				};
				
				// ignore some channels
				if (row.channel_id.match(/^(templates|echo|test)$/)) return;
				
				// remove colon from start of content, which only appears in SOME cases
				row.content = row.content.replace(/^\:/, '');
				
				if (!last_row) {
					// buffer and check against next
					last_row = row;
				}
				else if ((row.username == last_row.username) && (row.channel_id == last_row.channel_id) && (row.date - last_row.date <= 0.5)) {
					// matches up, append line to last
					print("Appending line to previous: " + line + "\n");
					last_row.date = row.date;
					last_row.line += "\n" + line;
					last_row.content += "<br/>" + row.content;
				}
				else {
					// new row, flush last, buffer next
					queue.push( last_row );
					last_row = row;
				}
			} // well-formed line
			else if (line.match(/\S/) && !line.match(/^\s*\[/) && !line.match(/^\s*\#/) && last_row) {
				// append loose line to last row (mobile upload?)
				print("Appending line to previous: " + line + "\n");
				last_row.line += "\n" + line;
				last_row.content += "<br/>" + line;
			}
		});
		
		rl.on('close', function() {
			print("RECEIVED RL CLOSE\n");
			// server.shutdown();
			
			if (last_row) {
				print("Enqueuing last row!\n");
				queue.push( last_row );
				last_row = null;
			}
		});
	},
	
	debugLevel: function(level) {
		// check if we're logging at or above the requested level
		return (this.logger.get('debugLevel') >= level);
	},
	
	logDebug: function(level, msg, data) {
		// proxy request to system logger with correct component
		this.logger.set( 'component', this.__name );
		this.logger.debug( level, msg, data );
	},
	
	logError: function(code, msg, data) {
		// proxy request to system logger with correct component
		this.logger.set( 'component', this.__name );
		this.logger.error( code, msg, data );
	},
	
	logTransaction: function(code, msg, data) {
		// proxy request to system logger with correct component
		this.logger.set( 'component', this.__name );
		this.logger.transaction( code, msg, data );
	}
	
};

server.startup( function() {
	// startup complete
	app.run();
} );

server.on('shutdown', function() {
	print("\nCaught shutdown event.  Bye!\n");
});
