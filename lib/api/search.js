// SpeechBubble API Layer - Search
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var assert = require("assert");
var async = require('async');

var Class = require("pixl-class");
var Tools = require("pixl-tools");

module.exports = Class.create({
	
	api_search: function(args, callback) {
		// perform search
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		
		if (!this.requireParams(params, {
			query: /.+/,
			offset: /^\d+$/,
			limit: /^\d+$/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			var text = params.query; delete params.query;
			
			if (user.restricted) {
				var dargs = Tools.getDateArgs(user.created);
				text += ' date:>=' + dargs.yyyy_mm_dd;
			}
			
			self.unbase.search( 'speech', text, params, function(err, data) {
				if (err) {
					return callback({ code: 'search', description: ''+err });
				}
				
				data.code = 0;
				callback(data);
				
			}); // search
		}); // loadSession
	},
	
	api_timeline: function(args, callback) {
		// perform timeline lookup
		var self = this;
		var params = Tools.mergeHashes( args.params, args.query );
		
		if (!this.requireParams(params, {
			channel: /^\w+$/,
			offset: /^\d+$/,
			limit: /^\d+$/
		}, callback)) return;
		
		var loadTimeline = function(channel, offset, limit) {
			var timeline_path = "timeline/" + channel;
			offset = parseInt( offset );
			limit = parseInt( limit );
			
			self.storage.listGet( timeline_path, offset, limit, function(err, items, list) {
				if (!items || !items.length) {
					return callback({ code: 0, offset: offset, records: [] });
				}
				
				var seq_ids = items.map( function(item) {
					return item.seq_id;
				} );
				
				self.unbase.get( 'speech', seq_ids, function(err, records) {
					callback({ code: 0, offset: offset, records: records || [], total: list.length });
				} ); // unbase.get
			} ); // listGet
		}; // loadTimeline
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			
			if (params.date && params.hour) {
				// first lookup date/hour from hash
				var timejump_path = "timejump/" + params.channel + "/" + params.date;
				
				if (user.restricted) {
					var epoch = (new Date(params.date + " 00:00:00")).getTime() / 1000;
					if (epoch < user.created) return callback({ code:0, offset:0, records:[] });
				}
				
				self.storage.hashGetAll( timejump_path, function(err, hash) {
					if (err) return callback({ code:0, offset:0, records:[] });
					var hour_stub = null;
					
					// find nearest populated hour in day
					for (var hour = parseInt(params.hour); hour < 24; hour++) {
						var hh = hour; if (hh < 10) hh = "0" + hh;
						var hour_code = 'h' + hh;
						if (hash[hour_code]) {
							hour_stub = hash[hour_code];
							hour = 24;
						}
					}
					
					if (!hour_stub) return callback({ code:0, offset:0, records:[] });
					
					loadTimeline( params.channel, hour_stub.timeline_idx, params.limit );
				} ); // hashGet
			}
			else if (params.seq_id) {
				// first lookup timeline_idx from DB record
				self.unbase.get( 'speech', params.seq_id, function(err, chat) {
					if (err) return callback({ code:0, offset:0, records:[] });
					
					// jump above target chat, to center it in the search results
					var timeline_idx = chat.timeline_idx - Math.floor(params.limit / 2);
					if (timeline_idx < 0) timeline_idx = 0;
					
					loadTimeline( params.channel, timeline_idx, params.limit );
				}); // unbase.get
			}
			else {
				// jump straight to exact offset/limit
				loadTimeline( params.channel, params.offset, params.limit );
			}
		}); // loadSession
	}
	
} );
