// SpeechBubble Web App
// Author: Joseph Huckaby
// Copyright (c) 2017 Joseph Huckaby and PixlCore.com

if (!window.app) throw new Error("App Framework is not present.");

app.extend({
	
	name: '',
	preload_images: ['loading.gif'],
	plain_text_post: false,
	query: parse_query_string( location.href ),
	default_prefs: {
		
	},
	
	receiveConfig: function(resp) {
		// receive config from server
		delete resp.code;
		window.config = resp.config;
		
		this.initTheme();
		
		// client login automation
		if (this.query.auth) {
			app.setPref( 'session_id', this.query.auth );
			setTimeout( function() { location.href = location.href.replace(/\?.+$/, ''); }, 1 );
			return;
		}
		
		for (var key in resp) {
			this[key] = resp[key];
		}
		
		// allow visible app name to be changed in config
		this.name = config.name;
		$('#d_header_title').html( '<b>' + this.name + '</b>' );
		
		this.config.Page = [
			{ ID: 'Home' },
			{ ID: 'Login' },
			{ ID: 'Channels' },
			{ ID: 'Emoji' },
			{ ID: 'MyAccount' },
			{ ID: 'Admin' }
		];
		this.config.DefaultPage = 'Home';
		
		// did we try to init and fail?  if so, try again now
		if (this.initReady) {
			this.hideProgress();
			delete this.initReady;
			this.init();
		}
	},
	
	init: function() {
		// initialize application
		if (this.abort) return; // fatal error, do not initialize app
		
		if (!this.config) {
			// must be in master server wait loop
			this.initReady = true;
			return;
		}
		
		// preload a few essential images
		for (var idx = 0, len = this.preload_images.length; idx < len; idx++) {
			var filename = '' + this.preload_images[idx];
			var img = new Image();
			img.src = '/images/'+filename;
		}
		
		// populate prefs for first time user
		for (var key in this.default_prefs) {
			if (!(key in window.localStorage)) {
				window.localStorage[key] = this.default_prefs[key];
			}
		}
		
		// pop version into footer
		$('#d_footer_version').html( "Version " + this.version || 0 );
		
		// some css munging for safari
		var ua = navigator.userAgent;
		if (ua.match(/Safari/) && !ua.match(/(Chrome|Opera)/)) {
			$('body').addClass('safari');
		}
		
		this.page_manager = new PageManager( always_array(config.Page) );
		
		if (!Nav.inited) Nav.init();
	},
	
	getUserAvatarURL: function(size, bust) {
		// get url to current user avatar
		var url = '';
		
		// user may have custom avatar
		if (this.user && this.user.avatar) {
			// convert to protocol-less URL
			url = this.user.avatar.replace(/^\w+\:/, '');
		}
		else {
			url = '/api/app/avatar/' + this.username + '.png?size=' + size;
		}
		
		if (bust) {
			url += (url.match(/\?/) ? '&' : '?') + 'random=' + Math.random();
		}
		
		return url;
	},
	
	updateHeaderInfo: function(bust) {
		// update top-right display
		var theme_ctrl = (app.getPref('theme') == 'dark') ? 
			'<i class="fa fa-moon-o fa-lg">&nbsp;</i>Dark' : 
			'<i class="fa fa-lightbulb-o fa-lg">&nbsp;</i>Light';
		
		var html = '';
		html += '<div class="header_divider right" style="margin-right:0;"></div>';
		html += '<div class="header_option logout right" onMouseUp="app.doUserLogout()"><i class="fa fa-power-off fa-lg">&nbsp;</i>Logout</div>';
		html += '<div class="header_divider right"></div>';
		html += '<div id="d_theme_ctrl" class="header_option right" onMouseUp="app.toggleTheme()" title="Toggle Light/Dark Theme">' + theme_ctrl + '</div>';
		html += '<div class="header_divider right"></div>';
		html += '<div id="d_header_user_bar" class="right" style="background-image:url(' + this.getUserAvatarURL( this.retina ? 64 : 32, bust ) + ')" onMouseUp="app.doMyAccount()">' + (this.user.nickname || this.username).replace(/\s+.+$/, '') + '</div>';
		$('#d_header_user_container').html( html );
	},
	
	doUserLogin: function(resp) {
		// user login, called from login page, or session recover
		// overriding this from base.js, so we can pass the session ID to the websocket
		delete resp.code;
		
		for (var key in resp) {
			this[key] = resp[key];
		}
		
		this.setPref('username', resp.username);
		this.setPref('session_id', resp.session_id);
		
		this.updateHeaderInfo();
		
		// show admin tab if user is worthy
		if (this.isAdmin()) $('#tab_Admin').show();
		else $('#tab_Admin').hide();
	},
	
	doUserLogout: function(bad_cookie) {
		// log user out and redirect to login screen
		var self = this;
		
		if (!bad_cookie) {
			// user explicitly logging out
			this.showProgress(1.0, "Logging out...");
			this.setPref('username', '');
		}
		
		this.api.post( 'user/logout', {
			session_id: this.getPref('session_id')
		}, 
		function(resp, tx) {
			delete self.user;
			delete self.username;
			delete self.user_info;
			
			self.setPref('session_id', '');
			
			$('#d_header_user_container').html( '' );
			
			if (app.config.external_users) {
				// external user api
				Debug.trace("User session cookie was deleted, querying external user API");
				setTimeout( function() {
					if (bad_cookie) app.doExternalLogin(); 
					else app.doExternalLogout(); 
				}, 250 );
			}
			else {
				Debug.trace("User session cookie was deleted, redirecting to login page");
				self.hideProgress();
				Nav.go('Login');
			}
			
			setTimeout( function() {
				if (!app.config.external_users) {
					if (bad_cookie) self.showMessage('error', "Your session has expired.  Please log in again.");
					else self.showMessage('success', "You were logged out successfully.");
				}
				
				delete self.plugins;
				delete self.epoch;
				
			}, 150 );
			
			$('#tab_Admin').hide();
		} );
	},
	
	doExternalLogin: function() {
		// login using external user management system
		// Force API to hit current page hostname vs. master server, so login redirect URL reflects it
		app.api.post( '/api/user/external_login', { cookie: document.cookie }, function(resp) {
			if (resp.user) {
				Debug.trace("User Session Resume: " + resp.username + ": " + resp.session_id);
				app.hideProgress();
				app.doUserLogin( resp );
				Nav.refresh();
			}
			else if (resp.location) {
				Debug.trace("External User API requires redirect");
				app.showProgress(1.0, "Logging in...");
				setTimeout( function() { window.location = resp.location; }, 250 );
			}
			else app.doError(resp.description || "Unknown login error.");
		} );
	},
	
	doExternalLogout: function() {
		// redirect to external user management system for logout
		var url = app.config.external_user_api;
		url += (url.match(/\?/) ? '&' : '?') + 'logout=1';
		
		Debug.trace("External User API requires redirect");
		app.showProgress(1.0, "Logging out...");
		setTimeout( function() { window.location = url; }, 250 );
	},
	
	get_password_toggle_html: function() {
		// get html for a password toggle control
		return '<span class="link password_toggle" onMouseUp="app.toggle_password_field(this)">Hide</span>';
	},
	
	toggle_password_field: function(span) {
		// toggle password field visible / masked
		var $span = $(span);
		var $field = $span.prev();
		if ($field.attr('type') == 'password') {
			$field.attr('type', 'text');
			$span.html( 'Hide' );
		}
		else {
			$field.attr('type', 'password');
			$span.html( 'Show' );
		}
	}
	
}); // app
