#!/usr/bin/env node

// Simple command-line search for Unbase Speech
// NOTE: DO NOT USE THIS WHILE SERVER IS ACTIVE -- could run into race conditions

// Usage: ./search.js "hello there guidenplopy" --limit 10

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

if (!cli.args.other || !cli.args.other.length) die("Usage: ./search.js \"hello there guidenplopy\" --limit 10\n");

config.debug = true;
// config.debug_level = 1;
// config.echo = true;
config.color = true;

config.Storage.transactions = false;

var server = new PixlServer({
	
	__name: 'SpeechSearch',
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
		
		delete cli.args.other;
		var params = cli.args;
		if (!params.offset) params.offset = 0;
		if (!params.limit) params.limit = 1;
		
		params.sort_by = "_id";
		params.sort_dir = -1;
		
		this.unbase.search( 'speech', text, params, function(err, data) {
			if (err) {
				die("Search Error: " + err + "\n");
			}
			
			print( JSON.stringify(data, null, "\t") + "\n" );
			
			server.shutdown();
			
		}); // search
	},
	
	run: function() {
		var self = this;
		this.__name = server.__name;
		this.logger = server.logger;
		
		var storage = this.storage = server.Storage;
		var unbase = this.unbase = server.Unbase;
		
		// storage system is ready to go
		// print("\nServer has started up\n");
		
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
