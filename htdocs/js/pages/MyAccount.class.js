Class.subclass( Page.Base, "Page.MyAccount", {	
		
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
		
		app.setWindowTitle('My Account');
		app.showTabBar(true);
		
		// setup upload system
		ZeroUpload.setURL( '/api/app/upload_avatar' );
		ZeroUpload.setMaxFiles( 1 );
		ZeroUpload.setMaxBytes( 1 * 1024 * 1024 ); // 1 MB
		ZeroUpload.setFileTypes( "image/jpeg", "image/png", "image/gif" );
		ZeroUpload.on('start', this.upload_start.bind(this) );
		ZeroUpload.on('complete', this.upload_complete.bind(this) );
		ZeroUpload.on('error', this.upload_error.bind(this) );
		ZeroUpload.init();
		
		this.receive_user({ user: app.user });
		
		return true;
	},
	
	receive_user: function(resp, tx) {
		var self = this;
		var html = '';
		var user = resp.user;
				
		html += '<div style="padding:50px 20px 50px 20px">';
		html += '<center>';
		
		html += '<table><tr>';
			html += '<td valign="top" style="vertical-align:top">';
			
		html += '<table style="margin:0;">';
		
		// user id
		html += get_form_table_row( 'Username', '<div style="font-size: 14px;"><b>' + app.username + '</b></div>' );
		html += get_form_table_caption( "Your username cannot be changed." );
		html += get_form_table_spacer();
		
		// nickname
		html += get_form_table_row( 'Nickname', '<input type="text" id="fe_ma_nickname" size="15" value="'+escape_text_field_value(user.nickname)+'"/>' );
		html += get_form_table_caption( "Your nickname, i.e. how you want to appear in chat.");
		html += get_form_table_spacer();
		
		// full name
		html += get_form_table_row( 'Full Name', '<input type="text" id="fe_ma_fullname" size="30" value="'+escape_text_field_value(user.full_name)+'"/>' );
		html += get_form_table_caption( "Your first and last names, used for display purposes only.");
		html += get_form_table_spacer();
		
		// email
		html += get_form_table_row( 'Email Address', '<input type="text" id="fe_ma_email" size="30" value="'+escape_text_field_value(user.email)+'"/>' );
		html += get_form_table_caption( "This is used to generate your profile pic, and to recover your password if you forget it." );
		html += get_form_table_spacer();
		
		// current password
		html += get_form_table_row( 'Current Password', '<input type="text" id="fe_ma_old_password" size="30" value=""/>' + app.get_password_toggle_html() );
		html += get_form_table_caption( "Enter your current account password to make changes." );
		html += get_form_table_spacer();
		
		// reset password
		html += get_form_table_row( 'New Password', '<input type="text" id="fe_ma_new_password" size="30" value=""/>' + app.get_password_toggle_html() );
		html += get_form_table_caption( "If you need to change your password, enter the new one here." );
		html += get_form_table_spacer();
		
		html += '<tr><td colspan="2" align="center">';
			html += '<div style="height:30px;"></div>';
			
			html += '<table><tr>';
				html += '<td><div class="button" style="width:130px; font-weight:normal;" onMouseUp="$P().show_delete_account_dialog()">Delete Account...</div></td>';
				html += '<td width="80">&nbsp;</td>';
				html += '<td><div class="button" style="width:130px;" onMouseUp="$P().save_changes()"><i class="fa fa-floppy-o">&nbsp;&nbsp;</i>Save Changes</div></td>';
			html += '</tr></table>';
			
		html += '</td></tr>';
		
		html += '</table>';
		html += '</center>';
		
		html += '</td>';
			html += '<td valign="top" align="left" style="vertical-align:top; text-align:left;">';
				// gravar profile image and edit button
				html += '<fieldset style="width:150px; margin-left:40px; background:transparent; box-shadow:none;"><legend>Profile Picture</legend>';
				if (app.config.external_users) {
					html += '<div id="d_ma_image" style="width:128px; height:128px; margin:5px auto 0 auto; background-image:url('+app.getUserAvatarURL(128)+'); cursor:default;"></div>';
				}
				else {
					html += '<div id="d_ma_image" style="width:128px; height:128px; margin:5px auto 0 auto; background-image:url('+app.getUserAvatarURL(128)+'); cursor:pointer;" onMouseUp="$P().upload_avatar()"></div>';
					html += '<div class="button mini" style="margin:10px auto 5px auto;" onMouseUp="$P().upload_avatar()">Upload Image...</div>';
				}
				html += '</fieldset>';
			html += '</td>';
		html += '</tr></table>';
		
		html += '</div>'; // table wrapper div
				
		this.div.html( html );
		
		setTimeout( function() {
			// app.password_strengthify( '#fe_ma_new_password' );
			
			if (app.config.external_users) {
				app.showMessage('warning', "Users are managed by an external system, so you cannot make changes here.");
				self.div.find('input').prop('disabled', true);
			}
		}, 1 );
	},
	
	upload_avatar: function() {
		// upload profile pic using ZeroUpload
		ZeroUpload.chooseFiles({
			session_id: app.getPref('session_id')
		});
	},
	
	upload_start: function(files, userData) {
		// avatar upload has started
		$('#d_ma_image').css( 'background-image', 'url(images/loading.gif)' );
	},
	
	upload_complete: function(response, userData) {
		// avatar upload has completed
		var data = null;
		try { data = JSON.parse( response.data ); }
		catch (err) {
			app.doError("Image Upload Failed: JSON Parse Error: " + err);
		}
		
		if (data && (data.code != 0)) {
			app.doError("Image Upload Failed: " + data.description);
		}
		
		$('#d_ma_image').css( 'background-image', 'url('+app.getUserAvatarURL(128, true)+')' );
		app.updateHeaderInfo(true);
	},
	
	upload_error: function(type, message, userData) {
		// avatar upload error
		app.doError("Image Upload Failed: " + message);
		$('#d_ma_image').css( 'background-image', 'url('+app.getUserAvatarURL(128)+')' );
	},
	
	save_changes: function(force) {
		// save changes to user info
		app.clearError();
		if (app.config.external_users) {
			return app.doError("Users are managed by an external system, so you cannot make changes here.");
		}
		if (!$('#fe_ma_old_password').val()) return app.badField('#fe_ma_old_password', "Please enter your current account password to make changes.");
		
		app.showProgress( 1.0, "Saving account..." );
		
		app.api.post( 'user/update', {
			username: app.username,
			nickname: trim($('#fe_ma_nickname').val()) || app.username,
			full_name: trim($('#fe_ma_fullname').val()),
			email: trim($('#fe_ma_email').val()),
			old_password: $('#fe_ma_old_password').val(),
			new_password: $('#fe_ma_new_password').val()
		}, 
		function(resp) {
			// save complete
			app.hideProgress();
			app.showMessage('success', "Your account settings were updated successfully.");
			
			$('#fe_ma_old_password').val('');
			$('#fe_ma_new_password').val('');
			
			app.user = resp.user;
			app.updateHeaderInfo();
			
			$('#d_ma_image').css( 'background-image', 'url('+app.getUserAvatarURL(128)+')' );
		} );
	},
	
	show_delete_account_dialog: function() {
		// show dialog confirming account delete action
		var self = this;
		
		app.clearError();
		if (app.config.external_users) {
			return app.doError("Users are managed by an external system, so you cannot make changes here.");
		}
		if (!$('#fe_ma_old_password').val()) return app.badField('#fe_ma_old_password', "Please enter your current account password.");
		
		app.confirm( "Delete My Account", "Are you sure you want to <b>permanently delete</b> your user account?  There is no way to undo this action, and no way to recover your data.", "Delete", function(result) {
			if (result) {
				app.showProgress( 1.0, "Deleting Account..." );
				app.api.post( 'user/delete', {
					username: app.username,
					password: $('#fe_ma_old_password').val()
				}, 
				function(resp) {
					// finished deleting, immediately log user out
					app.doUserLogout();
				} );
			}
		} );
	},
	
	onDeactivate: function() {
		// called when page is deactivated
		// this.div.html( '' );
		return true;
	}
	
} );
