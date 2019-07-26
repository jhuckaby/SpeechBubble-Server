#!/usr/bin/env node

// Simple command-line bulk update for Unbase Speech
// NOTE: DO NOT USE THIS WHILE SERVER IS ACTIVE -- could run into race conditions

// Usage: ./bulk-update.js "user:albrechd" --user dalbrecht

var Path = require('path');
var os = require('os');
var fs = require('fs');
var async = require('async');

var cli = require('pixl-cli');
cli.global();

var Tools = require('pixl-tools');
var PixlServer = require('pixl-server');

// chdir to the proper server root dir
process.chdir( Path.dirname( __dirname ) );

// load app's config file
var config = require('../conf/config.json');

if (!cli.args.other || !cli.args.other.length) die("Usage: ./bulk-update.js \"user:albrechd\" --user dalbrecht\n");

config.debug = true;
// config.debug_level = 1;
// config.echo = true;
config.color = true;

config.Storage.transactions = false;

var server = new PixlServer({
	
	__name: 'SpeechUpdater',
	__version: "1.0",
	
	config: config,
	
	components: [
		require('pixl-server-storage'),
		require('pixl-server-unbase')
	]
});

var app = {
	
	search: function() {
		// search DB
		var self = this;
		var text = cli.args.other.join(' ');
		
		var params = {
			offset: cli.args.offset || 0,
			limit: cli.args.limit || 9999,
			sort_by: "_id",
			sort_dir: -1
		};
		
		this.unbase.search( 'speech', text, params, function(err, data) {
			if (err) {
				die("Search Error: " + err + "\n");
			}
			if (!data || !data.total || !data.records || !data.records.length) {
				die("No records found.\n");
			}
			
			if (cli.args.verbose) print( JSON.stringify(data, null, "\t") + "\n" );
			print( data.records.length + " records found matching '" + text + "'.\n" );
			
			self.update(data);
		}); // search
	},
	
	update: function(data) {
		// perform bulk update
		var self = this;
		
		var updates = Tools.copyHash( cli.args );
		delete updates.other;
		delete updates.debug;
		delete updates.echo;
		delete updates.verbose;
		delete updates.offset;
		delete updates.limit;
		
		print( "Updates to be applied: " + JSON.stringify(updates, null, "\t") + "\n");
		
		cli.yesno("\nApply " + data.records.length + " updates now?", "n", function(yes) {
			if (!yes) die("User abort.\n");
			
			var update_records = [];
			data.records.forEach( function(record) {
				for (var key in updates) {
					if (!(key in record)) die("\nSANITY ABORT: Key '" + key + "' not found in record!! " + JSON.stringify(record) + "\n\n");
					record[key] = updates[key];
				}
				update_records.push({
					id: record.seq_id,
					data: record
				});
			});
			
			verbose( JSON.stringify(update_records, null, "\t") + "\n" );
			print("BULK UPDATE GO!\n\n");
			
			self.unbase.bulkInsert( 'speech', update_records, function(err) {
				if (err) die("Bulk Update Error: " + err + "\n");
				
				print("SUCCESS! BYE!\n\n");
				
				server.shutdown();
			} ); // bulkInsert
		} ); // confirm
	},
	
	run: function() {
		var self = this;
		this.__name = server.__name;
		this.logger = server.logger;
		
		var storage = this.storage = server.Storage;
		var unbase = this.unbase = server.Unbase;
		
		// storage system is ready to go
		print("\n");
		
		this.search();
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
	// print("\nCaught shutdown event.  Bye!\n");
});
