Class.subclass( Page.Base, "Page.Channels", {	
	
	onInit: function() {
		// called once at page load
		var html = '';
		this.div.html( html );
	},
	
	onActivate: function(args) {
		// page activation
		if (!this.requireLogin(args)) return true;
		
		if (!args) args = {};
		this.args = args;
		
		app.showTabBar(true);
		
		var sub = args.sub || 'list';
		this['gosub_'+sub](args);
		
		return true;
	},
	
	gosub_new: function(args) {
		// create new channel
		var html = '';
		app.setWindowTitle( "Add New Channel" );
		
		html += this.getSidebarTabs( 'new',
			[
				['list', "Channel List"],
				['new', "Add New Channel"]
			]
		);
		
		html += '<div style="padding:20px;"><div class="subtitle">Add New Channel</div></div>';
		
		html += '<div style="padding:0px 20px 50px 20px">';
		html += '<center><table style="margin:0;">';
		
		this.channel = {
			founder: app.username
		};
		
		html += this.get_channel_edit_html();
		
		html += '<tr><td colspan="2" align="center">';
			html += '<div style="height:30px;"></div>';
			
			html += '<table><tr>';
				html += '<td><div class="button" style="width:120px;" onMouseUp="$P().do_new_channel()"><i class="fa fa-plus-circle">&nbsp;&nbsp;</i>Add Channel</div></td>';
			html += '</tr></table>';
			
		html += '</td></tr>';
		
		html += '</table></center>';
		html += '</div>'; // table wrapper div
		
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
		
		setTimeout( function() {
			$('#fe_ec_name').focus();
		}, 1 );
	},
	
	do_new_channel: function() {
		// create new channel
		app.clearError();
		var channel = this.get_channel_form_json();
		if (!channel) return; // error
		
		this.channel = channel;
		
		app.showProgress( 1.0, "Creating channel..." );
		app.api.post( 'app/channel_create', channel, this.new_channel_finish.bind(this) );
	},
	
	new_channel_finish: function(resp, tx) {
		// new channel created successfully
		app.hideProgress();
		
		Nav.go('Channels?sub=list');
		
		setTimeout( function() {
			app.showMessage('success', "The new channel was added successfully.");
		}, 150 );
	},
	
	gosub_edit: function(args) {
		// edit channel subpage
		this.div.addClass('loading');
		app.api.post( 'app/channel_get', { id: args.channel }, this.receive_channel.bind(this) );
	},
	
	receive_channel: function(resp, tx) {
		// edit existing channel
		var html = '';
		this.channel = resp.channel;
		this.div.removeClass('loading');
		app.setWindowTitle( "Editing Channel \""+this.channel.title+"\"" );
		
		html += this.getSidebarTabs( 'edit',
			[
				['list', "Channel List"],
				['new', "Add New Channel"],
				['edit', "Edit Channel"],
				['users&channel=' + resp.channel.id, "Channel Users"]
			]
		);
		
		html += '<div style="padding:20px;"><div class="subtitle">Editing Channel &ldquo;' + this.channel.title + '&rdquo;</div></div>';
		
		html += '<div style="padding:0px 20px 50px 20px">';
		html += '<center>';
		html += '<table style="margin:0;">';
		
		html += this.get_channel_edit_html();
		
		html += '<tr><td colspan="2" align="center">';
			html += '<div style="height:30px;"></div>';
			
			html += '<table><tr>';
				html += '<td><div class="button" style="width:115px; font-weight:normal;" onMouseUp="$P().show_delete_channel_dialog()">Delete Channel...</div></td>';
				html += '<td width="50">&nbsp;</td>';
				html += '<td><div class="button" style="width:115px;" onMouseUp="$P().do_save_channel()"><i class="fa fa-floppy-o">&nbsp;&nbsp;</i>Save Changes</div></td>';
			html += '</tr></table>';
			
		html += '</td></tr>';
		
		html += '</table>';
		html += '</center>';
		html += '</div>'; // table wrapper div
		
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
		
		setTimeout( function() {
			$('#fe_ec_id').attr('disabled', true);
		}, 1 );
	},
	
	do_save_channel: function() {
		// save changes to existing channel
		app.clearError();
		var channel = this.get_channel_form_json();
		if (!channel) return; // error
		
		this.channel = channel;
		
		app.showProgress( 1.0, "Saving channel..." );
		app.api.post( 'app/channel_update', channel, this.save_channel_finish.bind(this) );
	},
	
	save_channel_finish: function(resp, tx) {
		// channel saved successfully
		app.hideProgress();
		window.scrollTo( 0, 0 );
		app.showMessage('success', "The channel was saved successfully.");
	},
	
	show_delete_channel_dialog: function() {
		// show dialog confirming channel delete action
		var self = this;
		app.confirm( '<span style="color:red">Delete Channel</span>', "Are you sure you want to delete the channel <b>"+this.channel.title+"</b>?  There is no way to undo this action.", "Delete", function(result) {
			if (result) {
				app.showProgress( 1.0, "Deleting Channel..." );
				app.api.post( 'app/channel_delete', {
					id: self.channel.id
				}, self.delete_finish.bind(self) );
			}
		} );
	},
	
	delete_finish: function(resp, tx) {
		// finished deleting, immediately log channel out
		app.hideProgress();
		
		Nav.go('Channels');
		
		setTimeout( function() {
			app.showMessage('success', "The channel was deleted successfully.");
		}, 150 );
	},
	
	get_channel_edit_html: function() {
		// get html for editing a channel (or creating a new one)
		var html = '';
		var channel = this.channel;
		
		var channel_name = channel.id || '';
		// if (channel_name && !channel_name.match(/^\#/)) channel_name = '#' + channel_name;
		
		// id
		html += get_form_table_row( 'Channel ID', '<input type="text" id="fe_ec_id" size="20" placeholder="mychannel" value="'+escape_text_field_value(channel_name)+'"/>' );
		html += get_form_table_caption( "Enter an alphanumeric identifer for the channel, e.g. \"mychannel\".  After creating the channel this cannot be changed.  Case insensitive.");
		html += get_form_table_spacer();
		
		// title
		html += get_form_table_row( 'Channel Title', '<input type="text" id="fe_ec_title" size="30" placeholder="" value="'+escape_text_field_value(channel.title)+'"/>' );
		html += get_form_table_caption( "Enter a display title for the channel, e.g. \"My Channel\".  This can be changed whenever you want.");
		html += get_form_table_spacer();
		
		// founder
		html += get_form_table_row( 'Founder', '<input type="text" id="fe_ec_founder" size="20" value="'+escape_text_field_value(channel.founder)+'"/>' );
		html += get_form_table_caption( "Specify the username of the channel's 'founder' (i.e. owner), who will always have admin privileges and can manage/delete the channel.");
		html += get_form_table_spacer();
		
		// access
		html += get_form_table_row( 'Access', '<select id="fe_ec_access">' + render_menu_options([['0','Public'], ['1','Private']], (channel.private == 1) ? 1 : 0) + '</select>' );
		html += get_form_table_caption( "Select either 'Public' (all users can join), or 'Private' (users must be added manually).");
		html += get_form_table_spacer();
		
		// topic
		html += get_form_table_row( 'Topic', '<textarea id="fe_ec_topic" style="width:600px;" rows="3">'+escape_text_field_value(channel.topic)+'</textarea>' );
		html += get_form_table_caption( "Optionally enter a topic (description) for the channel.  This can also be changed in chat by channel admins.");
		html += get_form_table_spacer();
		
		return html;
	},
	
	setPlaceholderTextFieldValue: function(checked, id) {
		// if checkbox is checked and associated text field is blank or 0, set to 'placeholder' attrib value
		if (checked) {
			var field = $('#' + id);
			if (!field.val() || (field.val() == "0")) {
				field.val( field.attr('placeholder') );
				field.focus();
			}
		}
	},
	
	setGroupVisible: function(group, visible) {
		// set the nick, chan, log or web groups of form fields visible or invisible, 
		// according to master checkbox for each section
		var selector = 'tr.' + group + 'group';
		if (visible) $(selector).show(250);
		else $(selector).hide(250);
	},
	
	get_channel_form_json: function() {
		// get channel json elements from form, used for new or edit
		var channel = {
			id: trim($('#fe_ec_id').val().toLowerCase().replace(/^\#+/, '')),
			title: trim($('#fe_ec_title').val()),
			topic: trim($('#fe_ec_topic').val()),
			private: parseInt( $('#fe_ec_access').val(), 10 ),
			founder: $('#fe_ec_founder').val()
		};
		
		if (!channel.id) return app.badField('fe_ec_id', "Please enter an ID for the channel.");
		if (!channel.title) return app.badField('fe_ec_title', "Please enter a title for the channel.");
		if (!channel.founder) return app.badField('fe_ec_founder', "Please enter a founder (owner) for the channel.");
		
		return channel;
	},
	
	gosub_list: function(args) {
		// show channel list
		app.setWindowTitle( "Channel List" );
		this.div.addClass('loading');
		if (!args.offset) args.offset = 0;
		if (!args.limit) args.limit = 50;
		app.api.get( 'app/channel_get_all', copy_object(args), this.receive_channels.bind(this) );
	},
	
	receive_channels: function(resp, tx) {
		// receive page of channels from server, render it
		var html = '';
		this.div.removeClass('loading');
		
		html += this.getSidebarTabs( 'list',
			[
				['list', "Channel List"],
				['new', "Add New Channel"]
			]
		);
		
		var cols = ['Channel', 'Users Online', 'My Status', 'Founder', 'Access', 'Created', 'Topic'];
		
		// html += '<div style="padding:5px 15px 15px 15px;">';
		html += '<div style="padding:20px 20px 30px 20px">';
		
		html += '<div class="subtitle">';
			html += 'Channel List';
			html += '<div class="subtitle_widget"><span class="link" onMouseUp="$P().refresh_channel_list()"><b>Refresh List</b></span></div>';
			html += '<div class="clear"></div>';
		html += '</div>';
		
		html += this.getPaginatedTable( resp, cols, 'channel', function(channel, idx) {
			channel.user_is_admin = app.isAdmin() || (channel.users && channel.users[app.username] && channel.users[app.username].admin);
			channel.num_live_users = num_keys(channel.live_users || {});
			
			var status = '(None)';
			if (channel.founder == app.username) status = '<span class="color_label founder">Founder</span>';
			else if (channel.user_is_admin) status = '<span class="color_label op">Admin</span>';
			
			var chan_html = '';
			if (channel.user_is_admin) {
				chan_html = '<div class="td_big"><a href="#Channels?sub=edit&channel='+channel.id+'">' + channel.title + '</a></div>';
			}
			else {
				chan_html = '<div class="td_big">' + channel.title + '</div>';
			}
			
			return [
				chan_html,
				commify( channel.num_live_users ),
				status,
				channel.founder,
				(channel.private == 1) ? '<span class="color_label private">Private</span>' : '<span class="color_label public">Public</span>',
				get_nice_date( channel.created ),
				expando_text( channel.topic || '(None)', 80 )
			];
		} );
		html += '</div>';
		
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
	},
	
	refresh_channel_list: function() {
		// refresh user list
		this.gosub_list(this.args);
	},
	
	gosub_users: function(args) {
		// view / edit users for channel
		this.div.addClass('loading');
		if (!args.offset) args.offset = 0;
		if (!args.limit) args.limit = 50;
		app.api.post( 'app/channel_get_users', copy_object(args), this.receive_channel_users.bind(this) );
	},
	
	receive_channel_users: function(resp, tx) {
		// receive page of users from server, render it
		var html = '';
		this.div.removeClass('loading');
		
		this.channel = resp.channel;
		app.setWindowTitle( "Users for Channel \"" + this.channel.title + "\"" );
		
		this.users = [];
		if (resp.rows) this.users = resp.rows;
		
		html += this.getSidebarTabs( 'users',
			[
				['list', "Channel List"],
				['new', "Add New Channel"],
				['edit&channel=' + this.args.channel, "Edit Channel"],
				['users', "Channel Users"]
			]
		);
		
		var cols = ['Username', 'Nickname', 'Full Name', 'Online', 'IP', 'Admin', 'Last Seen', 'Actions'];
		
		// html += '<div style="padding:10px 10px 20px 10px;">';
		html += '<div style="padding:20px 20px 30px 20px">';
		// html += '<div class="subtitle">Users for Channel ' + nch(this.channel.Name) + '</div>';
		
		html += '<div class="subtitle">';
			html += 'Users for Channel &ldquo;' + this.channel.title + '&rdquo;';
			html += '<div class="subtitle_widget"><span class="link" onMouseUp="$P().refresh_channel_users()"><b>Refresh List</b></span></div>';
			html += '<div class="subtitle_widget">Filter: ';
				if (!this.args.filter || (this.args.filter == 'all')) html += '<b>All</b>';
				else html += '<span class="link" onMouseUp="$P().set_channel_user_filter(\'all\')">All</span>';
				html += ' - ';
				if (this.args.filter && (this.args.filter == 'online')) html += '<b>Online</b>';
				else html += '<span class="link" onMouseUp="$P().set_channel_user_filter(\'online\')">Online</span>';
			html += '</div>';
			html += '<div class="clear"></div>';
		html += '</div>';
		
		html += this.getPaginatedTable( resp, cols, 'user', function(user, idx) {
			var actions = [];
			if (user.live) {
				actions.push( '<span class="link" onMouseUp="$P().kick_channel_user('+idx+')"><b>Kick</b></span>' );
			}
			// actions.push( '<span class="link" onMouseUp="$P().ban_channel_user('+idx+')"><b>Ban</b></span>' );
			// if (user.Registered) {
				actions.push( '<span class="link" onMouseUp="$P().delete_channel_user('+idx+')"><b>Remove</b></span>' );
			// }
			
			var username_open = '';
			var username_close = '';
			if (app.isAdmin()) {
				username_open = '<div class="td_big"><a href="#Admin?sub=edit_user&username='+user.username+'">';
				username_close = '</a></div>';
			}
			else {
				username_open = '<div class="td_big">';
				username_close = '</div>';
			}
			
			return [
				username_open + (user.username) + username_close,
				user.nickname,
				user.full_name,
				user.live ? '<span class="color_label online">Yes</span>' : '<span class="color_label offline">No</span>',
				user.ip || 'n/a',
				'<input type="checkbox" value="1" ' + (user.admin ? 'checked="checked"' : '') + ' onChange="$P().set_channel_user_admin('+idx+',this)"/>',
				user.last_cmd_time ? get_short_date_time( user.last_cmd_time ) : 'n/a',
				actions.join(' | ')
			];
		} );
		html += '</div>';
		
		// add user button
		html += '<div class="button center" style="width:120px; margin-bottom:10px;" onMouseUp="$P().add_channel_user()">Add User...</div>';
		
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
	},
	
	set_channel_user_filter: function(filter) {
		// filter user list and refresh
		this.args.filter = filter;
		this.args.offset = 0;
		this.refresh_channel_users();
	},
	
	refresh_channel_users: function() {
		// refresh user list
		this.gosub_users(this.args);
	},
	
	add_channel_user: function() {
		// show dialog prompting for new user to add to channel
		var self = this;
		var html = '';
		html += '<table>' + get_form_table_row('Username:', '<input type="text" id="fe_ec_username" size="30" value=""/>') + '</table>';
		html += '<div class="caption">Please enter the registered username of the user to add to the channel.</div>';
		
		app.confirm( "Add User to " + this.channel.title, html, "Add User", function(result) {
			if (result) {
				var username = trim($('#fe_ec_username').val());
				Dialog.hide();
				if (username.match(/^\w+$/)) {
					app.showProgress( 1.0, "Adding user..." );
					app.api.post( 'app/channel_add_user', {
						channel: self.channel.id,
						username: username
					}, 
					function(resp, tx) {
						app.hideProgress();
						app.showMessage('success', "User '"+username+"' was successfully added to the channel.");
						self.gosub_users(self.args);
					} ); // api.post
				} // good username
				else app.doError("The username you entered is invalid (alphanumerics only please).");
			} // user clicked add
		} ); // app.confirm
		
		setTimeout( function() { 
			$('#fe_ec_username').focus().keypress( function(event) {
				if (event.keyCode == '13') { // enter key
					event.preventDefault();
					app.confirm_click(true);
				}
			} );
		}, 1 );
	},
	
	set_channel_user_admin: function(idx, elem) {
		// set channel user to admin or standard (from checkbox state)
		var self = this;
		var user = this.users[idx];
		var is_admin = $(elem).is(':checked');
		
		app.api.post( 'app/channel_modify_user', {
			channel: self.channel.id,
			username: user.username,
			admin: is_admin ? 1 : 0
		}, 
		function(resp, tx) {
			app.showMessage('success', user.full_name + (is_admin ? ' is now an administrator of the channel.' : ' is no longer a channel administrator.'));
			self.gosub_users(self.args);
		} ); // api.post
	},
	
	delete_channel_user: function(idx) {
		// remove user from channel
		var self = this;
		var user = this.users[idx];
		
		app.api.post( 'app/channel_delete_user', {
			channel: self.channel.id,
			username: user.username
		}, 
		function(resp, tx) {
			app.showMessage('success', "User '"+user.full_name+"' was removed from the channel.");
			self.gosub_users(self.args);
		} ); // api.post
	},
	
	kick_channel_user: function(idx) {
		// kick user out of channel
		var self = this;
		var user = this.users[idx];
		
		app.api.post( 'app/channel_kick_user', {
			channel: self.channel.id,
			username: user.username
		}, 
		function(resp, tx) {
			app.showMessage('success', "User '"+user.full_name+"' was kicked from the channel.");
			self.gosub_users(self.args);
		} ); // api.post
	},
	
	onDeactivate: function() {
		// called when page is deactivated
		return true;
	}
	
} );
